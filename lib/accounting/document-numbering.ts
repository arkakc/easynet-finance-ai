import { randomInt } from "node:crypto";

function twoLetterCode(documentName: string) {
  const cleaned = String(documentName || "DO").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  return (cleaned || "DO").padEnd(2, "X").slice(0, 2);
}

export function documentSeriesId(documentName: string, year = new Date().getUTCFullYear()) {
  const sequence = String(randomInt(0, 100000)).padStart(5, "0");
  return `${twoLetterCode(documentName)}-${sequence}-${year}`;
}

export function documentLineId(documentId: string, lineNo: number) {
  return `${documentId}-${String(lineNo).padStart(3, "0")}`;
}
