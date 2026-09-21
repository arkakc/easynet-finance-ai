import { env } from "@/lib/env";
import {
  prismaAppendRecord,
  prismaBatchAppend,
  prismaFindRecords,
  prismaListTable,
  prismaPostJournal,
  prismaUpdateRecord,
} from "@/lib/backend/prisma-store";

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
  service?: BackendService;
} & T;

type JournalBundle = {
  header: Record<string, unknown>;
  lines: Record<string, unknown>[];
  actor?: string;
};

type ServiceConfig = { url: string; token: string; source: "split" | "legacy" };

const RETRYABLE_STATUS = new Set([404, 408, 409, 425, 429, 500, 502, 503, 504]);
const RETRY_DELAYS_MS = [0, 250];
const HEALTH_RETRY_DELAYS_MS = [0, 750, 1_500];
const READ_ONLY_ACTIONS = new Set<BackendAction>(["health", "bootstrapStatus", "list", "find"]);
const READ_TIMEOUT_MS = 12_000;
const HEALTH_TIMEOUT_MS = 18_000;
const READ_CACHE_TTL_MS = 4_000;

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

const readCache = new Map<string, { storedAt: number; value: BackendEnvelope<any> }>();
const readInflight = new Map<string, Promise<BackendEnvelope<any>>>();

async function queuedWrite<T>(service: BackendService, task: () => Promise<T>): Promise<T> {
  const previous = writeQueues[service];
  let release!: () => void;
  writeQueues[service] = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  try { return await task(); }
  finally { release(); }
}

function splitConfig(service: BackendService) {
  return service === "core"
    ? { url: env.CORE_APPS_SCRIPT_WEB_APP_URL, token: env.CORE_APPS_SCRIPT_API_TOKEN }
    : service === "reporting"
      ? { url: env.REPORTING_APPS_SCRIPT_WEB_APP_URL, token: env.REPORTING_APPS_SCRIPT_API_TOKEN }
      : { url: env.DOCUMENT_APPS_SCRIPT_WEB_APP_URL, token: env.DOCUMENT_APPS_SCRIPT_API_TOKEN };
}

function serviceConfig(service: BackendService): ServiceConfig {
  const legacyUrl = env.APPS_SCRIPT_WEB_APP_URL;
  const legacyToken = env.APPS_SCRIPT_API_TOKEN;
  const split = splitConfig(service);
  const hasSplitUrl = Boolean(split.url);
  const hasSplitToken = Boolean(split.token);

  if (hasSplitUrl && hasSplitToken) {
    return { url: split.url!, token: split.token!, source: "split" };
  }

  // Never silently route a partially configured split service back to the old
  // all-in-one database. That can make UAT appear to work while writing data to
  // the wrong backend. A partial pair is therefore a hard configuration error.
  if (hasSplitUrl !== hasSplitToken) {
    throw new Error(`${service} split backend is partially configured. Both the Apps Script URL and API token are required.`);
  }

  if (legacyUrl && legacyToken) return { url: legacyUrl, token: legacyToken, source: "legacy" };

  throw new Error(`${service} Apps Script backend is not configured`);
}

export const CORE_DATA_AUTHORITY = "prisma" as const;

export function backendConfigStatus() {
  const statusFor = (service: BackendService) => {
    const split = splitConfig(service);
    const splitUrl = Boolean(split.url);
    const splitToken = Boolean(split.token);
    const legacyUrl = Boolean(env.APPS_SCRIPT_WEB_APP_URL);
    const legacyToken = Boolean(env.APPS_SCRIPT_API_TOKEN);
    const partial = splitUrl !== splitToken;
    const source = splitUrl && splitToken
      ? "split"
      : partial
        ? "partial-error"
        : legacyUrl && legacyToken
          ? "legacy"
          : "unconfigured";
    return { source, splitUrl, splitToken, partial, legacyFallbackReady: legacyUrl && legacyToken };
  };

  const externalCore = statusFor("core");
  const reporting = statusFor("reporting");
  const document = statusFor("document");

  return {
    // Core financial/operational data is intentionally Prisma-only. Keep
    // source="unconfigured" for backward-compatible callers that previously
    // used this flag to select the local path, while exposing any retired
    // Apps Script core configuration for diagnostics only.
    core: {
      ...externalCore,
      source: "unconfigured" as const,
      authority: CORE_DATA_AUTHORITY,
      externalSource: externalCore.source,
      externalConfigured: externalCore.source !== "unconfigured",
      externalIgnored: externalCore.source !== "unconfigured",
    },
    reporting: {
      ...reporting,
      authority: reporting.source === "unconfigured" ? "prisma-fallback" as const : "apps-script" as const,
    },
    document: {
      ...document,
      authority: document.source === "unconfigured" ? "prisma-metadata" as const : "apps-script-integration" as const,
    },
  };
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
function readKey(service: BackendService, action: BackendAction, payload: Record<string, unknown>) {
  return `${service}:${action}:${JSON.stringify(payload)}`;
}

async function executeBackend<T>(
  service: BackendService,
  action: BackendAction,
  payload: Record<string, unknown>,
): Promise<BackendEnvelope<T>> {
  const config = serviceConfig(service);
  let lastError: Error | null = null;
  const retryDelays = action === "health" ? HEALTH_RETRY_DELAYS_MS : RETRY_DELAYS_MS;
  const maxAttempts = READ_ONLY_ACTIONS.has(action) ? retryDelays.length : 1;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (retryDelays[attempt]) await sleep(retryDelays[attempt]);
    try {
      const response = await fetch(config.url, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ token: config.token, action, payload }),
        cache: "no-store",
        redirect: "follow",
        signal: READ_ONLY_ACTIONS.has(action)
          ? AbortSignal.timeout(action === "health" ? HEALTH_TIMEOUT_MS : READ_TIMEOUT_MS)
          : undefined,
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
      if (!data.ok) {
        const backendMessage = String(data.error || "");
        if (backendMessage.trim().toLowerCase() === "unauthorized") {
          throw new BackendApplicationError(`${service} backend authentication failed (${config.source} configuration). Check the ${service.toUpperCase()} Apps Script URL/API token pair in this Vercel environment.`);
        }
        throw new BackendApplicationError(backendMessage || `${service} Apps Script backend returned an error`);
      }
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
  if (service === "core") {
    throw new Error("Core Apps Script access is disabled. Prisma is the single source of truth for core data.");
  }
  if (READ_ONLY_ACTIONS.has(action)) {
    const key = readKey(service, action, payload);
    const cached = readCache.get(key);
    if (cached && Date.now() - cached.storedAt <= READ_CACHE_TTL_MS) return cached.value as BackendEnvelope<T>;
    const existing = readInflight.get(key);
    if (existing) return existing as Promise<BackendEnvelope<T>>;

    const task = executeBackend<T>(service, action, payload);
    readInflight.set(key, task as Promise<BackendEnvelope<any>>);
    try {
      const value = await task;
      readCache.set(key, { storedAt: Date.now(), value });
      return value;
    } finally {
      readInflight.delete(key);
    }
  }

  const result = await queuedWrite(service, () => executeBackend<T>(service, action, payload));
  readCache.clear();
  return result;
}

export function isBackendConfigured(service: BackendService = "core"): boolean {
  if (service === "core") return false;
  const status = backendConfigStatus();
  return status[service]?.source !== "unconfigured" && status[service]?.source !== "partial-error";
}

export async function backendHealth(service: BackendService = "core") {
  if (service === "core") {
    try {
      // Exercise the authoritative database rather than reporting a static
      // configuration value. A failed Prisma read must fail core health.
      await prismaListTable<Record<string, unknown>>("Settings", 1, 0);
      return {
        ok: true,
        version: "prisma-core",
        service,
        authority: CORE_DATA_AUTHORITY,
      } as BackendEnvelope<{ version?: string; authority?: typeof CORE_DATA_AUTHORITY }>;
    } catch (error) {
      return {
        ok: false,
        service,
        authority: CORE_DATA_AUTHORITY,
        error: error instanceof Error ? error.message : "Prisma core health check failed",
      } as BackendEnvelope<{ version?: string; authority?: typeof CORE_DATA_AUTHORITY }>;
    }
  }

  if (!isBackendConfigured(service)) {
    return {
      ok: false,
      service,
      error: `${service} Apps Script integration is not configured`,
    } as BackendEnvelope<{ version?: string }>;
  }
  return callBackend<{ version: string }>("health", {}, service);
}

export async function backendHealthAll() {
  const services: BackendService[] = ["core", "reporting", "document"];
  const entries = await Promise.all(services.map(async (service) => {
    try {
      const result = await backendHealth(service);
      return [service, { ok: result.ok, version: result.version, error: result.error }] as const;
    } catch (error) {
      return [service, { ok: false, error: error instanceof Error ? error.message : "Health check failed" }] as const;
    }
  }));
  return Object.fromEntries(entries) as Record<BackendService, { ok: boolean; version?: string; error?: string }>;
}

const PROTOCOL_RETRY_DELAYS_MS = [0, 200];

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
  const rows = await prismaListTable<T>(table, limit, offset);
  return {
    ok: true,
    service: "core" as const,
    authority: CORE_DATA_AUTHORITY,
    rows,
  } as BackendEnvelope<{ authority: typeof CORE_DATA_AUTHORITY; rows: T[] }>;
}

export async function findRecords<T = Record<string, unknown>>(table: string, filters: Record<string, unknown>, limit = 100) {
  const rows = await prismaFindRecords<T>(table, filters, limit);
  return {
    ok: true,
    service: "core" as const,
    authority: CORE_DATA_AUTHORITY,
    rows,
  } as BackendEnvelope<{ authority: typeof CORE_DATA_AUTHORITY; rows: T[] }>;
}

export async function listReportingTable<T = Record<string, unknown>>(table: string, limit = 100, offset = 0) {
  if (!isBackendConfigured("reporting")) {
    const rows = await prismaListTable<T>(table, limit, offset);
    return { ok: true, service: "reporting" as const, rows } as BackendEnvelope<{ rows: T[] }>;
  }
  return readRowsWithProtocolRetry<T>("list", table, { table, limit, offset }, "reporting");
}

export async function findReportingRecords<T = Record<string, unknown>>(table: string, filters: Record<string, unknown>, limit = 100) {
  if (!isBackendConfigured("reporting")) {
    const rows = await prismaFindRecords<T>(table, filters, limit);
    return { ok: true, service: "reporting" as const, rows } as BackendEnvelope<{ rows: T[] }>;
  }
  return readRowsWithProtocolRetry<T>("find", table, { table, filters, limit }, "reporting");
}

export async function appendRecord<T = Record<string, unknown>>(table: string, record: Record<string, unknown>, actor = "web-app") {
  const row = await prismaAppendRecord<T>(table, record, actor);
  return {
    ok: true,
    service: "core" as const,
    authority: CORE_DATA_AUTHORITY,
    row,
  } as BackendEnvelope<{ authority: typeof CORE_DATA_AUTHORITY; row: T }>;
}

export async function batchAppend<T = Record<string, unknown>>(table: string, records: Record<string, unknown>[], actor = "web-app") {
  const rows = await prismaBatchAppend<T>(table, records, actor);
  return {
    ok: true,
    service: "core" as const,
    authority: CORE_DATA_AUTHORITY,
    rows,
  } as BackendEnvelope<{ authority: typeof CORE_DATA_AUTHORITY; rows: T[] }>;
}

export async function updateRecord<T = Record<string, unknown>>(table: string, idField: string, idValue: string, patch: Record<string, unknown>, actor = "web-app") {
  const row = await prismaUpdateRecord<T>(table, idField, idValue, patch, actor);
  return {
    ok: true,
    service: "core" as const,
    authority: CORE_DATA_AUTHORITY,
    row,
  } as BackendEnvelope<{ authority: typeof CORE_DATA_AUTHORITY; row: T }>;
}

export async function postJournalRecord(input: JournalBundle) {
  const posted = await prismaPostJournal(input);
  return {
    ok: true,
    service: "core" as const,
    authority: CORE_DATA_AUTHORITY,
    ...posted,
  } as BackendEnvelope<{
    authority: typeof CORE_DATA_AUTHORITY;
    journalId: string;
    header: Record<string, unknown>;
    lines: Record<string, unknown>[];
  }>;
}

export async function uploadSourceFile(input: { fileName: string; mimeType: string; base64: string; sha256: string; documentId?: string }) {
  return callBackend<{ driveFileId: string; driveUrl: string; sha256: string }>("uploadSource", input, "document");
}

export async function deleteSourceFile(driveFileId: string, reason = "rollback") {
  return callBackend<{ driveFileId: string; trashed: boolean }>("deleteSource", { driveFileId, reason }, "document");
}
