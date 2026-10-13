export type ReleaseCheck = { key: string; label: string; blocking: boolean; passed: boolean; detail: string };
export function conversionClaimsReadiness(open: number, total: number): ReleaseCheck {
 if (!Number.isSafeInteger(open) || open < 0 || !Number.isSafeInteger(total) || total < open) throw new Error("Invalid conversion claim counts");
 return { key: "conversion-claims", label: "Conversion failure and in-progress claims reconciled", blocking: true, passed: open === 0,
  detail: open === 0 ? `No unresolved claims among ${total} conversion requests`
  : `${open} conversion request(s) PENDING or IN_REVIEW. Reconcile downstream target and posted journals before manual release; never retry blindly.` };
}
