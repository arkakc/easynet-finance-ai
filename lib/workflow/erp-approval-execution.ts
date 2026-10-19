/**
 * Opt-in transactional workflow execution for ErpApprovalCase records.
 * No API route calls this module yet. All callers MUST supply a DB-validated
 * actor and company context (never a client-supplied actor ID or role).
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/src/lib/prisma";
import { canAct, requiredApproverRoles, type ErpRole, type DocumentKind, type WorkflowStatus } from "./erp-approval-policy";
import { nextApprovalStatus, type WorkflowDecision } from "./erp-approval-transitions";

type Command = {
  companyId: string;
  caseId: string;
  actorId: string;
  actorRoles: readonly ErpRole[];
  decision: WorkflowDecision;
  note?: string;
  expectedStatus: WorkflowStatus;
};

/** Atomic case-state update, approval step update and append-only event. */
export async function executeApprovalDecision(command: Command) {
  if (!command.companyId || !command.caseId || !command.actorId) throw new Error("Missing authenticated workflow context");
  if (command.note && command.note.length > 500) throw new Error("Approval note too long");

  return prisma.$transaction(async (tx) => {
    const record = await tx.erpApprovalCase.findFirst({
      where: { id: command.caseId, companyId: command.companyId },
      include: { steps: { orderBy: { ordinal: "asc" } }, events: { orderBy: { occurredAt: "asc" } } },
    });
    if (!record) throw new Error("Approval case not found");
    if (record.status !== command.expectedStatus) throw new Error("Stale approval case state");
    const status = record.status as WorkflowStatus;
    const kind = record.documentKind as DocumentKind;
    const reviewers = record.events.filter((e) => e.action === "REVIEW").map((e) => e.actorUserId);
    const approvers = record.steps.filter((s) => s.decision === "APPROVED").map((s) => s.decidedByUserId).filter((s): s is string => Boolean(s));
    const reviewContext = {
      documentKind: kind, status, amountPgk: Number(record.amountPgk),
      actorId: command.actorId, creatorId: record.creatorUserId,
      roles: command.actorRoles, reviewedBy: reviewers, approvedBy: approvers,
    };
    const policyAction = command.decision === "SUBMIT" ? "SUBMIT"
      : command.decision === "APPROVE" ? "APPROVE" : "REVIEW";
    if (command.decision === "REJECT" || command.decision === "RETURN") {
      if (!command.note?.trim()) throw new Error("Reason required for return/rejection");
    }
    const check = canAct(reviewContext, command.decision === "SUBMIT" ? "SUBMIT"
      : command.decision === "APPROVE" ? "APPROVE"
      : command.decision === "RETURN" || command.decision === "REJECT" ? "RETURN" : policyAction);
    if (!check.allowed) throw new Error(check.reason);

    let remaining = 0;
    if (command.decision === "APPROVE") {
      const required = requiredApproverRoles(kind, Number(record.amountPgk));
      if (record.steps.length !== required.length || record.steps.some((step, i) => step.ordinal !== i || step.requiredRole !== required[i]))
        throw new Error("Persisted steps differ from approved policy; re-evaluate case");
      const index = record.steps.findIndex((step) => step.decision === "PENDING");
      if (index < 0 || record.steps.slice(0, index).some((step) => step.decision !== "APPROVED"))
        throw new Error("Invalid or completed approval step sequence");
      const step = record.steps[index];
      if (step.assignedUserId && step.assignedUserId !== command.actorId) throw new Error("Step assigned to another approver");
      const result = await tx.erpApprovalStep.updateMany({
        where: { id: step.id, decision: "PENDING" },
        data: { decision: "APPROVED", decidedByUserId: command.actorId, decisionNote: command.note?.trim() || null, decidedAt: new Date() },
      });
      if (result.count !== 1) throw new Error("Concurrent approval step update");
      remaining = record.steps.length - index - 1;
    }
    const nextStatus = nextApprovalStatus(status, command.decision, remaining);
    const cas = await tx.erpApprovalCase.updateMany({
      where: { id: record.id, companyId: command.companyId, status: record.status, activeStepIndex: record.activeStepIndex },
      data: { status: nextStatus, activeStepIndex: command.decision === "APPROVE" ? record.activeStepIndex + 1 : record.activeStepIndex },
    });
    if (cas.count !== 1) throw new Error("Concurrent approval status update");
    await tx.erpApprovalEvent.create({
      data: {
        caseId: record.id, actorUserId: command.actorId, action: command.decision,
        fromStatus: status, toStatus: nextStatus,
        note: command.note?.trim() || null,
      },
    });
    return { caseId: record.id, previousStatus: status, status: nextStatus, remainingApprovals: remaining };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
