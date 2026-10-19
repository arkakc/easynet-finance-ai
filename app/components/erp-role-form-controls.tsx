"use client";

import type { PrivilegeAction } from "@/lib/workflow/erp-role-privileges";
import { resolveFormAccess } from "@/lib/workflow/erp-form-permissions";

type Props = {
  allowedActions: readonly PrivilegeAction[];
  status: string;
  isCreator: boolean;
  onAction?: (action: "CREATE"|"EDIT_DRAFT"|"DELETE_DRAFT"|"SUBMIT"|"APPROVE"|"POST") => void;
  previewOnly?: boolean;
};
/** Buttons are disabled until a verified document-specific mutation handler is supplied. */
export default function ErpRoleFormControls({ allowedActions, status, isCreator, onAction, previewOnly = true }: Props) {
  const allowed = resolveFormAccess(allowedActions, status, isCreator);
  const entries = [
    ["CREATE", "Create", allowed.canCreate],
    ["EDIT_DRAFT", "Edit Draft", allowed.canEditDraft],
    ["DELETE_DRAFT", "Delete Draft", allowed.canDeleteDraft],
    ["SUBMIT", "Submit", allowed.canSubmit],
    ["APPROVE", "Approve", allowed.canApprove],
    ["POST", "Post", allowed.canPost],
  ] as const;
  return <div className="button-row" aria-label="Role-restricted document actions">
    {entries.map(([action,label,enabled])=><button key={action} type="button" disabled={!enabled||previewOnly||!onAction} onClick={()=>onAction?.(action)} title={previewOnly?"Preview only — backend authorization is not activated":undefined}>{label}</button>)}
  </div>;
}
