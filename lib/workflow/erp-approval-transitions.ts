import type { WorkflowStatus } from "./erp-approval-policy";

export type WorkflowDecision = "SUBMIT" | "REVIEW" | "APPROVE" | "RETURN" | "REJECT";
export function nextApprovalStatus(
  current: WorkflowStatus,
  action: WorkflowDecision,
  approvalStepsRemaining = 0,
): WorkflowStatus {
  if (action === "SUBMIT" && current === "DRAFT") return "SUBMITTED";
  if (action === "REVIEW" && current === "SUBMITTED") return "UNDER_REVIEW";
  if (action === "RETURN" && ["SUBMITTED", "UNDER_REVIEW"].includes(current)) return "DRAFT";
  if (action === "REJECT" && ["SUBMITTED", "UNDER_REVIEW"].includes(current)) return "CANCELLED";
  if (action === "APPROVE" && current === "UNDER_REVIEW" && Number.isInteger(approvalStepsRemaining) && approvalStepsRemaining >= 0)
    return approvalStepsRemaining === 0 ? "APPROVED" : "UNDER_REVIEW";
  throw new Error(`Invalid approval transition: ${current} → ${action}`);
}
