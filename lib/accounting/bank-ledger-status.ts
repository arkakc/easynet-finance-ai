export const UNLINKED_BANK_LEDGER_MARKER = "[UNLINKED_BANK_LEDGER]";
const AUTO_CREATED_BANK_LEDGER_DESCRIPTION = "Auto-created bank ledger linked to a physical company bank account";

export function isExplicitlyUnlinkedBankLedger(description?: string | null) {
  return String(description || "").includes(UNLINKED_BANK_LEDGER_MARKER);
}

export function isManagedBankLedgerDescription(description?: string | null) {
  const value = String(description || "");
  return value.includes(UNLINKED_BANK_LEDGER_MARKER) || value.includes(AUTO_CREATED_BANK_LEDGER_DESCRIPTION);
}

export function isUnlinkedBankLedger(
  description: string | null | undefined,
  activeBankLinkCount: number,
) {
  return isExplicitlyUnlinkedBankLedger(description)
    || (isManagedBankLedgerDescription(description) && Number(activeBankLinkCount || 0) === 0);
}

export function markUnlinkedBankLedgerDescription(description?: string | null) {
  const clean = String(description || "").trim();
  if (clean.includes(UNLINKED_BANK_LEDGER_MARKER)) return clean;
  return [clean, UNLINKED_BANK_LEDGER_MARKER].filter(Boolean).join(" · ");
}

export function clearUnlinkedBankLedgerMarker(description?: string | null) {
  return String(description || "")
    .replaceAll(UNLINKED_BANK_LEDGER_MARKER, "")
    .replace(/\s*·\s*·\s*/g, " · ")
    .replace(/^\s*·\s*|\s*·\s*$/g, "")
    .trim();
}
