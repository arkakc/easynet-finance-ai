import { env } from "@/lib/env";

type BackendAction =
  | "health"
  | "bootstrapStatus"
  | "list"
  | "find"
  | "append"
  | "update"
  | "batchAppend"
  | "uploadSource";

type BackendEnvelope<T = unknown> = {
  ok: boolean;
  error?: string;
} & T;

function assertConfigured() {
  if (!env.APPS_SCRIPT_WEB_APP_URL || !env.APPS_SCRIPT_API_TOKEN) {
    throw new Error("Apps Script backend is not configured");
  }
}

export async function callBackend<T = unknown>(
  action: BackendAction,
  payload: Record<string, unknown> = {},
): Promise<BackendEnvelope<T>> {
  assertConfigured();

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

  if (!response.ok) {
    throw new Error(`Apps Script backend HTTP ${response.status}`);
  }

  const data = (await response.json()) as BackendEnvelope<T>;
  if (!data.ok) {
    throw new Error(data.error || "Apps Script backend returned an error");
  }
  return data;
}

export async function backendHealth() {
  return callBackend<{ version: string }>("health");
}

export async function listTable<T = Record<string, unknown>>(
  table: string,
  limit = 100,
  offset = 0,
) {
  return callBackend<{ rows: T[] }>("list", { table, limit, offset });
}

export async function findRecords<T = Record<string, unknown>>(
  table: string,
  filters: Record<string, unknown>,
  limit = 100,
) {
  return callBackend<{ rows: T[] }>("find", { table, filters, limit });
}

export async function appendRecord<T = Record<string, unknown>>(
  table: string,
  record: Record<string, unknown>,
  actor = "web-app",
) {
  return callBackend<{ row: T }>("append", { table, record, actor });
}

export async function batchAppend<T = Record<string, unknown>>(
  table: string,
  records: Record<string, unknown>[],
  actor = "web-app",
) {
  return callBackend<{ rows: T[] }>("batchAppend", { table, records, actor });
}

export async function updateRecord<T = Record<string, unknown>>(
  table: string,
  idField: string,
  idValue: string,
  patch: Record<string, unknown>,
  actor = "web-app",
) {
  return callBackend<{ row: T }>("update", {
    table,
    idField,
    idValue,
    patch,
    actor,
  });
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
