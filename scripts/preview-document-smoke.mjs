import { createHash } from "node:crypto";

const marker = "[document-smoke]";
const commitMessage = process.env.VERCEL_GIT_COMMIT_MESSAGE || "";
const preview = process.env.VERCEL_ENV === "preview";

if (!preview || !commitMessage.includes(marker)) {
  console.log("[document-smoke] skipped", { preview, markerPresent: commitMessage.includes(marker) });
  process.exit(0);
}

const url = process.env.DOCUMENT_APPS_SCRIPT_WEB_APP_URL;
const token = process.env.DOCUMENT_APPS_SCRIPT_API_TOKEN;

if (!url || !token) {
  console.error("[document-smoke] missing Document backend URL/token");
  process.exit(1);
}

async function call(action, payload = {}) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ token, action, payload }),
    redirect: "follow",
  });
  const raw = await response.text();
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(`Document backend returned non-JSON content (${response.status})`);
  }
  if (!response.ok) throw new Error(`Document backend HTTP ${response.status}`);
  if (!data || data.ok !== true) throw new Error(String(data?.error || "Document backend error"));
  return data;
}

const runId = (process.env.VERCEL_GIT_COMMIT_SHA || `${Date.now()}`).slice(0, 10).toUpperCase();
const documentId = `DOC-SMOKE-${runId}`;
const fileName = `document-smoke-${runId}.txt`;
const fileContents = `Easynet document service smoke test ${runId}\n`;
const base64 = Buffer.from(fileContents, "utf8").toString("base64");
const sha256 = createHash("sha256").update(fileContents).digest("hex");
const now = new Date().toISOString();

const result = {
  runId,
  health: null,
  initialRead: null,
  write: null,
  update: null,
  upload: null,
  delete: null,
  finalRead: null,
};

try {
  result.health = await call("health");

  const initial = await call("list", { table: "Documents", limit: 5, offset: 0 });
  result.initialRead = { ok: true, rowCount: Array.isArray(initial.rows) ? initial.rows.length : 0 };

  const existing = await call("find", { table: "Documents", filters: { documentId }, limit: 1 });
  if (!Array.isArray(existing.rows) || existing.rows.length === 0) {
    const appended = await call("append", {
      table: "Documents",
      record: {
        documentId,
        sourceFileName: fileName,
        driveFileId: "",
        driveUrl: "",
        sha256: "",
        documentType: "SMOKE_TEST",
        documentNumber: documentId,
        partyType: "",
        partyId: "",
        projectId: "",
        documentDate: now.slice(0, 10),
        netAmount: 0,
        gstAmount: 0,
        totalAmount: 0,
        currency: "PGK",
        aiConfidence: 1,
        status: "SMOKE_CREATED",
        uploadedBy: "preview-document-smoke",
        createdAt: now,
        updatedAt: now,
      },
    });
    result.write = { ok: true, documentId: appended.row?.documentId || documentId };
  } else {
    result.write = { ok: true, documentId, reusedExisting: true };
  }

  const updated = await call("update", {
    table: "Documents",
    idField: "documentId",
    idValue: documentId,
    patch: { status: "SMOKE_UPDATED" },
  });
  if (String(updated.row?.status || "") !== "SMOKE_UPDATED") throw new Error("Document update verification failed");
  result.update = { ok: true, status: updated.row.status };

  const uploaded = await call("uploadSource", {
    documentId,
    fileName,
    mimeType: "text/plain",
    base64,
    sha256,
  });
  if (!uploaded.driveFileId) throw new Error("Document upload did not return a Drive file ID");
  result.upload = { ok: true, driveFileId: uploaded.driveFileId, sha256: uploaded.sha256 };

  await call("update", {
    table: "Documents",
    idField: "documentId",
    idValue: documentId,
    patch: {
      driveFileId: uploaded.driveFileId,
      driveUrl: uploaded.driveUrl || "",
      sha256,
      status: "SMOKE_UPLOADED",
    },
  });

  const deleted = await call("deleteSource", { driveFileId: uploaded.driveFileId });
  if (deleted.trashed !== true) throw new Error("Document source delete did not report trashed=true");
  result.delete = { ok: true, driveFileId: deleted.driveFileId, trashed: true };

  await call("update", {
    table: "Documents",
    idField: "documentId",
    idValue: documentId,
    patch: { status: "SMOKE_DELETED" },
  });

  const final = await call("find", { table: "Documents", filters: { documentId }, limit: 1 });
  const finalRow = Array.isArray(final.rows) ? final.rows[0] : null;
  if (!finalRow || String(finalRow.status || "") !== "SMOKE_DELETED") throw new Error("Final Document row verification failed");
  result.finalRead = {
    ok: true,
    documentId: finalRow.documentId,
    status: finalRow.status,
    hasDriveFileId: Boolean(finalRow.driveFileId),
    sha256Matches: String(finalRow.sha256 || "") === sha256,
  };

  console.log("[document-smoke] PASS", JSON.stringify(result, null, 2));
} catch (error) {
  console.error("[document-smoke] FAIL", JSON.stringify({
    ...result,
    error: error instanceof Error ? error.message : String(error),
  }, null, 2));
  process.exit(1);
}
