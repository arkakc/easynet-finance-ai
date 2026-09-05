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

type BackendService = "core" | "reporting" | "document";

type BackendEnvelope<T = unknown> = {
  ok: boolean;
  error?: string;
} & T;

type JournalBundle = {
  header: Record<string, unknown>;
  lines: Record<string, unknown>[];
  actor?: string;
};

type ServiceConfig = { url: string; token: string; source: "split" | "legacy" };

const RETRYABLE_STATUS = new Set([404, 408, 409, 425, 429, 500, 502, 503, 504]);
const RETRY_DELAYS_MS = [0, 250, 700, 1400];
const READ_ONLY_ACTIONS = new Set<BackendAction>(["health", "bootstrapStatus", "list", "find"]);

const DOCUMENT_TABLES = new Set(["Documents", "DocumentLines"]);
const REPORTING_TABLES = new Set([
  "ReportDailySales",
  "ReportDailyPurchases",
  "ReportARSummary",
  "ReportAPSummary",
  "ReportGSTSummary",
  "ReportProjectProfitability",
  "ReportDashboardKPI",
]);

class BackendApplicationError extends Error {}

/*
 * Writes are serialized per service, not globally. This prevents a Drive upload
 * or reporting refresh from blocking a finance transaction write.
 */
const writeQueues: Record<BackendService, Promise<void>> = {
  core: Promise.resolve(),
  reporting: Promise.resolve(),
  document: Promise.resolve(),
};

async function queuedWrite<T>(service: BackendService, task: () => Promise<T>): Promise<T> {
  const previous = writeQueues[service];
  let release!: () => void;
  writeQueues[service] = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  try { return await task(); }
  finally { release(); }
}

function serviceConfig(service: BackendService): ServiceConfig {
  const legacyUrl = env.APPS_SCRIPT_WEB_APP_URL;
  const legacyToken = env.APPS_SCRIPT_API_TOKEN;

  const split = service === "core"
    ? { url: env.CORE_APPS_SCRIPT_WEB_APP_URL, token: env.CORE_APPS_SCRIPT_API_TOKEN }
    : service === "reporting"
      ? { url: env.REPORTING_APPS_SCRIPT_WEB_APP_URL, token: env.REPORTING_APPS_SCRIPT_API_TOKEN }
      : { url: env.DOCUMENT_APPS_SCRIPT_WEB_APP_URL, token: env.DOCUMENT_APPS_SCRIPT_API_TOKEN };

  if (split.url && split.token) return { url: split.url, token: split.token, source: "split" };
  if (legacyUrl && legacyToken) return { url: legacyUrl, token: legacyToken, source: "legacy" };

  throw new Error(`${service} Apps Script backend is not configured`);
}

function serviceFor(action: BackendAction, payload: Record<string, unknown>): BackendService {
  if (action === "uploadSource" || action === "deleteSource") return "document";
  const table = String(payload.table || "");
  if (DOCUMENT_TABLES.has(table)) return "document";
  if (REPORTING_TABLES.has(table)) return "reporting";
  return "core";
}

function sleep(ms: number) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function safeSnippet(value: string, max = 220) { return value.replace(/\s+/g, " ").trim().slice(0, max); }

async function executeBackend<T>(
  service: BackendService,
  action: BackendAction,
  payload: Record<string, unknown>,
): Promise<BackendEnvelope<T>> {
  const config = serviceConfig(service);
  let lastError: Error | null = null;
  const maxAttempts = READ_ONLY_ACTIONS.has(action) ? RETRY_DELAYS_MS.length : 1;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (RETRY_DELAYS_MS[attempt]) await sleep(RETRY_DELAYS_MS[attempt]);
    try {
      const response = await fetch(config.url, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ token: config.token, action, payload }),
        cache: "no-store",
        redirect: "follow",
      });
      const raw = await response.text();
      if (!response.ok) {
        const detail = safeSnippet(raw);
        const error = new Error(`${service} Apps Script backend HTTP ${response.status}${detail ? `: ${detail}` : ""}`);
        lastError = error;
        if (READ_ONLY_ACTIONS.has(action) && RETRYABLE_STATUS.has(response.status) && attempt < maxAttempts - 1) continue;
        throw error;
      }
      let data: BackendEnvelope<T>;
      try { data = JSON.parse(raw) as BackendEnvelope<T>; }
      catch { throw new Error(`${service} Apps Script backend returned non-JSON content: ${safeSnippet(raw) || "empty response"}`); }
      if (!data || typeof data !== "object" || typeof data.ok !== "boolean") {
        throw new Error(`${service} Apps Script backend returned an invalid response envelope`);
      }
      if (!data.ok) throw new BackendApplicationError(data.error || `${service} Apps Script backend returned an error`);
      return data;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(`${service} Apps Script backend request failed`);
      if (error instanceof BackendApplicationError) throw error;
      if (!READ_ONLY_ACTIONS.has(action) || attempt >= maxAttempts - 1) throw lastError;
    }
  }
  throw lastError || new Error(`${service} Apps Script backend request failed`);
}

export async function callBackend<T = unknown>(
  action: BackendAction,
  payload: Record<string, unknown> = {},
  explicitService?: BackendService,
): Promise<BackendEnvelope<T>> {
  const service = explicitService || serviceFor(action, payload);
  if (READ_ONLY_ACTIONS.has(action)) return executeBackend<T>(service, action, payload);
  return queuedWrite(service, () => executeBackend<T>(service, action, payload));
}

export async function backendHealth(service: BackendService = "core") {
  return callBackend<{ version: string }>("health", {}, service);
}

export async function backendHealthAll() {
  const services: BackendService[] = ["core", "reporting", "document"];
  const entries = await Promise.all(services.map(async (service) => {
    try {
      const result = await backendHealth(service);
      return [service, { ok: true, version: result.version }] as const;
    } catch (error) {
      return [service, { ok: false, error: error instanceof Error ? error.message : "Health check failed" }] as const;
    }
  }));
  return Object.fromEntries(entries) as Record<BackendService, { ok: boolean; version?: string; error?: string }>;
}

const PROTOCOL_RETRY_DELAYS_MS = [0, 180, 450, 900];

async function readRowsWithProtocolRetry<T>(
  action: "list" | "find",
  table: string,
  payload: Record<string, unknown>,
  explicitService?: BackendService,
): Promise<BackendEnvelope<{ rows: T[] }>> {
  let lastShape = "";
  for (let attempt = 0; attempt < PROTOCOL_RETRY_DELAYS_MS.length; attempt += 1) {
    if (PROTOCOL_RETRY_DELAYS_MS[attempt]) await sleep(PROTOCOL_RETRY_DELAYS_MS[attempt]);
    const result = await callBackend<{ rows?: T[] }>(action, payload, explicitService);
    if (Array.isArray(result.rows)) return { ...result, rows: result.rows } as BackendEnvelope<{ rows: T[] }>;
    lastShape = Object.keys(result || {}).sort().join(",") || "empty-object";
  }
  throw new Error(`Apps Script protocol error: ${action}(${table}) did not return rows[] after ${PROTOCOL_RETRY_DELAYS_MS.length} attempts (response keys: ${lastShape})`);
}

export async function listTable<T = Record<string, unknown>>(table: string, limit = 100, offset = 0) {
  return readRowsWithProtocolRetry<T>("list", table, { table, limit, offset });
}

export async function findRecords<T = Record<string, unknown>>(table: string, filters: Record<string, unknown>, limit = 100) {
  return readRowsWithProtocolRetry<T>("find", table, { table, filters, limit });
}

export async function listReportingTable<T = Record<string, unknown>>(table: string, limit = 100, offset = 0) {
  return readRowsWithProtocolRetry<T>("list", table, { table, limit, offset }, "reporting");
}

export async function findReportingRecords<T = Record<string, unknown>>(table: string, filters: Record<string, unknown>, limit = 100) {
  return readRowsWithProtocolRetry<T>("find", table, { table, filters, limit }, "reporting");
}

export async function appendRecord<T = Record<string, unknown>>(table: string, record: Record<string, unknown>, actor = "web-app") {
  const result = await callBackend<{ row?: T }>("append", { table, record, actor });
  if (!result.row || typeof result.row !== "object") throw new Error(`Apps Script protocol error: append(${table}) did not return row`);
  return { ...result, row: result.row } as BackendEnvelope<{ row: T }>;
}

export async function batchAppend<T = Record<string, unknown>>(table: string, records: Record<string, unknown>[], actor = "web-app") {
  const result = await callBackend<{ rows?: T[] }>("batchAppend", { table, records, actor });
  if (!Array.isArray(result.rows)) throw new Error(`Apps Script protocol error: batchAppend(${table}) did not return rows[]`);
  return { ...result, rows: result.rows } as BackendEnvelope<{ rows: T[] }>;
}

export async function updateRecord<T = Record<string, unknown>>(table: string, idField: string, idValue: string, patch: Record<string, unknown>, actor = "web-app") {
  const result = await callBackend<{ row?: T }>("update", { table, idField, idValue, patch, actor });
  if (!result.row || typeof result.row !== "object") throw new Error(`Apps Script protocol error: update(${table}) did not return row`);
  return { ...result, row: result.row } as BackendEnvelope<{ row: T }>;
}

export async function postJournalRecord(input: JournalBundle) {
  return callBackend<{ journalId: string; header: Record<string, unknown>; lines: Record<string, unknown>[] }>("postJournal", input, "core");
}

export async function uploadSourceFile(input: { fileName: string; mimeType: string; base64: string; sha256: string; documentId?: string }) {
  return callBackend<{ driveFileId: string; driveUrl: string; sha256: string }>("uploadSource", input, "document");
}

export async function deleteSourceFile(driveFileId: string, reason = "rollback") {
  return callBackend<{ driveFileId: string; trashed: boolean }>("deleteSource", { driveFileId, reason }, "document");
}
