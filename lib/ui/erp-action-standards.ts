export type ErpAction = "create" | "saveDraft" | "edit" | "delete" | "submit" | "approve" | "reject" | "finalPost" | "cancel" | "reverse" | "disable" | "activate" | "view";
export type ErpDocumentState = "DRAFT" | "SUBMITTED" | "PENDING_APPROVAL" | "APPROVED" | "POSTED" | "REJECTED" | "CANCELLED";
export type ErpActionTone = "primary" | "secondary" | "danger" | "warning" | "success";
export const erpActionAppearance: Record<ErpAction, { label: string; tone: ErpActionTone; confirm: boolean }> = {
  create: { label: "Create New", tone: "primary", confirm: false },
  saveDraft: { label: "Save Draft", tone: "primary", confirm: false },
  edit: { label: "Edit", tone: "secondary", confirm: false },
  delete: { label: "Delete Draft", tone: "danger", confirm: true },
  submit: { label: "Submit for Approval", tone: "primary", confirm: true },
  approve: { label: "Approve", tone: "success", confirm: true },
  reject: { label: "Reject", tone: "warning", confirm: true },
  finalPost: { label: "Final Save / Post", tone: "success", confirm: true },
  cancel: { label: "Cancel", tone: "warning", confirm: true },
  reverse: { label: "Reverse", tone: "danger", confirm: true },
  disable: { label: "Disable", tone: "warning", confirm: true },
  activate: { label: "Activate", tone: "secondary", confirm: false },
  view: { label: "View Existing", tone: "secondary", confirm: false },
};
// Display eligibility only. API permissions, maker-checker, linked-document checks,
// period locks and accounting validation remain authoritative.
const allowed: Record<ErpDocumentState, readonly ErpAction[]> = {
  DRAFT: ["view", "edit", "saveDraft", "delete", "submit"],
  SUBMITTED: ["view", "approve", "reject"],
  PENDING_APPROVAL: ["view", "approve", "reject"],
  APPROVED: ["view", "finalPost", "cancel"],
  POSTED: ["view", "reverse"],
  REJECTED: ["view", "edit", "saveDraft", "submit", "delete"],
  CANCELLED: ["view"],
};
export function documentActionVisible(state: ErpDocumentState, action: ErpAction): boolean {
  return allowed[state]?.includes(action) ?? false;
}
