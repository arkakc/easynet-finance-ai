import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(process.cwd(), "storage", "document-evidence");
const MIME: Record<string, string> = { "application/pdf": ".pdf", "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp" };
export const MAX_EVIDENCE_BYTES = 10 * 1024 * 1024;
export function allowedEvidenceMime(mime: string) { return MIME[mime] || null; }
export async function saveEvidenceFile(file: File) {
  const mime = file.type.toLowerCase();
  const extension = allowedEvidenceMime(mime);
  if (!extension || file.size < 1 || file.size > MAX_EVIDENCE_BYTES) throw new Error("Only PDF, PNG, JPEG or WebP up to 10 MB are allowed.");
  const bytes = Buffer.from(await file.arrayBuffer());
  const signatures: Record<string, boolean> = {
    "application/pdf": bytes.subarray(0, 5).toString() === "%PDF-",
    "image/png": bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])),
    "image/jpeg": bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
    "image/webp": bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP",
  };
  if (!signatures[mime]) throw new Error("File signature does not match selected format.");
  await mkdir(ROOT, { recursive: true, mode: 0o700 });
  const filename = randomUUID() + extension;
  await writeFile(path.join(ROOT, filename), bytes, { flag: "wx", mode: 0o600 });
  return { location: `evidence:${filename}`, size: bytes.length, mime };
}
export async function readEvidenceFile(location: string) {
  const match = /^evidence:([0-9a-f-]{36})\.(pdf|png|jpg|webp)$/.exec(location);
  if (!match) throw new Error("Not a private local evidence file");
  const filename = match[1] + "." + match[2];
  return readFile(path.join(ROOT, filename));
}
// Local disk is not shared/durable across serverless deployments; configure durable private object storage before production use.
