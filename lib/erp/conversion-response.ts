/**
 * Treat an HTTP 2xx without explicit { ok: true } as an uncertain conversion.
 * Never permit an ambiguous legacy backend response to mark a claim APPROVED.
 */
export async function assertSuccessfulConversionResponse(response: Response): Promise<void> {
  const body: unknown = await response.clone().json().catch(() => null);
  if (response.ok && body && typeof body === "object" && "ok" in body && body.ok === true) return;
  const error = body && typeof body === "object" && "error" in body && typeof body.error === "string"
    ? body.error : "Controlled conversion outcome uncertain; reconcile linked documents before retrying.";
  throw new Error(error);
}
