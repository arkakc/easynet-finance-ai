import { env } from "@/lib/env";

type BackendAction =
  | "health"
  | "bootstrapStatus"
  | "list"
  | "find"
  | "append"
  | "update"
  | "batchAppend"
  | "postJournal"
  | "uploadSource"
  | "deleteSource";

type BackendEnvelope<T = unknown> = {
  ok: boolean;
  error?: string;
} & T;

type JournalBundle = {
  header: Record<string, unknown>;
  lines: Record<string, unknown>[];
  actor?: string;
};

const RETRYABLE_STATUS = new Set([404, 408, 409, 425, 429, 500, 502, 503, 504]);
const RETRY_DELAYS_MS = [0, 250, 700, 1400];
const READ_ONLY_ACTIONS = new Set<BackendAction>(["health", "bootstrapStatus", "list", "find"]);

class BackendApplicationError extends Error {}

/**
 * Google Apps Script + SpreadsheetApp is materially more reliable when requests
 * from one Next.js worker are not fired concurrently. Promise.all() is used in
 * several pages, so all backend calls are funneled through this queue.
 */
let backendQueue: Promise<void> = Promise.resolve();

async function queued<T>(task: () => Promise<T>): Promise<T> {
  const previous = backendQueue;
  let release!: () => void;
  backendQueue = new Promise<void>((resolve) => {
    release = resolve;
  });

  await previous;
  try {
    return await task();
  } finally {
    release();
  }
}

function assertConfigured() {
  if (!env.APPS_SCRIPT_WEB_APP_URL || !env.APPS_SCRIPT_API_TOKEN) {
    throw new Error("Apps Script backend is not configured");
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function safeSnippet(value: string, max = 220) {
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}

async function executeBackend<T>(
  action: BackendAction,
  payload: Record<string, unknown>,
): Promise<BackendEnvelope<T>> {
  assertConfigured();

  let lastError: Error | null = null;
  const maxAttempts = READ_ONLY_ACTIONS.has(action) ? RETRY_DELAYS_MS.length : 1;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (RETRY_DELAYS_MS[attempt]) await sleep(RETRY_DELAYS_MS[attempt]);

    try {
      const response = await fetch(env.APPS_SCRIPT_WEB_APP_URL!, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({
          token: env.APPS_SCRIPT_API_TOKEN,
          action,
          payload,
        }),
        cache: "no-store",
        redirect: "follow",
      });

      const raw = await response.text();

      if (!response.ok) {
        const detail = safeSnippet(raw);
        const error = new Error(
          `Apps Script backend HTTP ${response.status}${detail ? `: ${detail}` : ""}`,
        );
        lastError = error;

        if (READ_ONLY_ACTIONS.has(action) && RETRYABLE_STATUS.has(response.status) && attempt < maxAttempts - 1) {
          continue;
        }
        throw error;
      }

      let data: BackendEnvelope<T>;
      try {
        data = JSON.parse(raw) as BackendEnvelope<T>;
      } catch {
        throw new Error(`Apps Script backend returned non-JSON content: ${safeSnippet(raw) || "empty response"}`);
      }

      if (!data || typeof data !== "object" || typeof data.ok !== "boolean") {
        throw new Error("Apps Script backend returned an invalid response envelope");
      }

      if (!data.ok) {
        throw new BackendApplicationError(data.error || "Apps Script backend returned an error");
      }

      return data;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("Apps Script backend request failed");
      if (error instanceof BackendApplicationError) throw error;
      if (!READ_ONLY_ACTIONS.has(action) || attempt >= maxAttempts - 1) throw lastError;
    }
  }

  throw lastError || new Error("Apps Script backend request failed");
}

export async function callBackend<T = unknown>(
  action: BackendAction,
  payload: Record<string, unknown> = {},
): Promise<BackendEnvelope<T>> {
  return queued(() => executeBackend<T>(action, payload));
}

export async function backendHealth() {
  return callBackend<{ version: string }>("health");
}

const PROTOCOL_RETRY_DELAYS_MS = [0, 180, 450, 900];

async function readRowsWithProtocolRetry<T>(
  action: "list" | "find",
  table: string,
  payload: Record<string, unknown>,
): Promise<BackendEnvelope<{ rows: T[] }>> {
  let lastShape = "";

  for (let attempt = 0; attempt < PROTOCOL_RETRY_DELAYS_MS.length; attempt += 1) {
    if (PROTOCOL_RETRY_DELAYS_MS[attempt]) {
      await sleep(PROTOCOL_RETRY_DELAYS_MS[attempt]);
    }

    const result = await callBackend<{ rows?: T[] }>(action, payload);
    if (Array.isArray(result.rows)) {
      return { ...result, rows: result.rows } as BackendEnvelope<{ rows: T[] }>;
    }

    // Google Apps Script ContentService can occasionally return a valid JSON
    // envelope from the web-app endpoint without the action-specific payload
    // while the deployment is under bursty read load. Reads are idempotent, so
    // retry the protocol shape before failing the page/API request. Never apply
    // this retry policy to write actions because a write may already have run.
    lastShape = Object.keys(result || {}).sort().join(",") || "empty-object";
  }

  throw new Error(
    `Apps Script protocol error: ${action}(${table}) did not return rows[] after ${PROTOCOL_RETRY_DELAYS_MS.length} attempts (response keys: ${lastShape})`,
  );
}

export async function listTable<T = Record<string, unknown>>(
  table: string,
  limit = 100,
  offset = 0,
) {
  return readRowsWithProtocolRetry<T>("list", table, { table, limit, offset });
}

export async function findRecords<T = Record<string, unknown>>(
  table: string,
  filters: Record<string, unknown>,
  limit = 100,
) {
  return readRowsWithProtocolRetry<T>("find", table, { table, filters, limit });
}

export async function appendRecord<T = Record<string, unknown>>(
  table: string,
  record: Record<string, unknown>,
  actor = "web-app",
) {
  const result = await callBackend<{ row?: T }>("append", { table, record, actor });
  if (!result.row || typeof result.row !== "object") {
    throw new Error(`Apps Script protocol error: append(${table}) did not return row`);
  }
  return { ...result, row: result.row } as BackendEnvelope<{ row: T }>;
}

export async function batchAppend<T = Record<string, unknown>>(
  table: string,
  records: Record<string, unknown>[],
  actor = "web-app",
) {
  const result = await callBackend<{ rows?: T[] }>("batchAppend", { table, records, actor });
  if (!Array.isArray(result.rows)) {
    throw new Error(`Apps Script protocol error: batchAppend(${table}) did not return rows[]`);
  }
  return { ...result, rows: result.rows } as BackendEnvelope<{ rows: T[] }>;
}

export async function updateRecord<T = Record<string, unknown>>(
  table: string,
  idField: string,
  idValue: string,
  patch: Record<string, unknown>,
  actor = "web-app",
) {
  const result = await callBackend<{ row?: T }>("update", {
    table,
    idField,
    idValue,
    patch,
    actor,
  });
  if (!result.row || typeof result.row !== "object") {
    throw new Error(`Apps Script protocol error: update(${table}) did not return row`);
  }
  return { ...result, row: result.row } as BackendEnvelope<{ row: T }>;
}

export async function postJournalRecord(input: JournalBundle) {
  return callBackend<{
    journalId: string;
    header: Record<string, unknown>;
    lines: Record<string, unknown>[];
  }>("postJournal", input);
}

export async function uploadSourceFile(input: {
  fileName: string;
  mimeType: string;
  base64: string;
  sha256: string;
  documentId?: string;
}) {
  return callBackend<{
    driveFileId: string;
    driveUrl: string;
    sha256: string;
  }>("uploadSource", input);
}

export async function deleteSourceFile(driveFileId: string, reason = "rollback") {
  return callBackend<{ driveFileId: string; trashed: boolean }>("deleteSource", {
    driveFileId,
    reason,
  });
}
