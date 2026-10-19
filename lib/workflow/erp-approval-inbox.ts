import type { ErpRole, WorkflowStatus } from "./erp-approval-policy";

export type ApprovalInboxRow = {
  id: string;
  companyId: string;
  documentKind: string;
  documentNo: string;
  amountPgk: number;
  creatorUserId: string;
  status: WorkflowStatus;
  requiredRole: ErpRole | null;
  assignedUserId?: string | null;
  policyVersion: number;
  updatedAt: string;
};

/** Presentation-only filter. The API must enforce company scope and permissions
 * independently before returning any records.
 */
export function visibleApprovalRows(
  rows: readonly ApprovalInboxRow[],
  context: { companyId: string; userId: string; roles: readonly ErpRole[] },
): ApprovalInboxRow[] {
  if (!context.companyId || !context.userId || !context.roles.length) return [];
  return rows.filter((row) =>
    row.companyId === context.companyId
    && ["SUBMITTED", "UNDER_REVIEW"].includes(row.status)
    && row.creatorUserId !== context.userId
    && row.requiredRole !== null
    && context.roles.includes(row.requiredRole)
    && (!row.assignedUserId || row.assignedUserId === context.userId),
  ).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function pendingValuePgk(rows: readonly ApprovalInboxRow[]): number {
  return rows.reduce((sum, row) => sum + (Number.isFinite(row.amountPgk) ? row.amountPgk : 0), 0);
}
