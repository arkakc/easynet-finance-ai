import type { PrivilegeAction } from "./erp-role-privileges";

export type FormAccess = {
  canRead: boolean;
  canCreate: boolean;
  canEditDraft: boolean;
  canDeleteDraft: boolean;
  canSubmit: boolean;
  canApprove: boolean;
  canPost: boolean;
};
/** Presentation rules only. Server-side checks are mandatory on every write. */
export function resolveFormAccess(actions: readonly PrivilegeAction[], status: string, isCreator: boolean): FormAccess {
  const draft = status.trim().toUpperCase() === "DRAFT";
  const set = new Set(actions);
  return {
    canRead: set.has("READ"),
    canCreate: set.has("CREATE"),
    canEditDraft: draft && isCreator && set.has("EDIT_DRAFT"),
    canDeleteDraft: draft && isCreator && set.has("DELETE_DRAFT"),
    canSubmit: draft && isCreator && set.has("SUBMIT"),
    canApprove: !isCreator && ["SUBMITTED", "UNDER_REVIEW"].includes(status.trim().toUpperCase()) && set.has("APPROVE"),
    canPost: status.trim().toUpperCase() === "APPROVED" && set.has("POST"),
  };
}
