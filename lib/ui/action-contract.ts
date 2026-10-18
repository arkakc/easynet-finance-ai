export class ActionFailure extends Error {
  constructor(message: string, readonly uncertain = false) { super(message); this.name = 'ActionFailure'; }
}
export async function executeAction<T extends { ok?: boolean; error?: string }>(url: string, init: RequestInit, label: string): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    let response: Response;
    try { response = await fetch(url, { ...init, signal: controller.signal, cache: 'no-store' }); }
    catch { throw new ActionFailure(label + ': network timeout or disconnect. Outcome unknown; check saved record status before retrying.', true); }
    const result = await response.json().catch(() => null) as T | null;
    if (!response.ok || !result || result.ok !== true) throw new ActionFailure(label + ': ' + (result?.error || 'HTTP ' + response.status));
    return result;
  } finally { clearTimeout(timeout); }
}
