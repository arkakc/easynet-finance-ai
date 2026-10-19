/**
 * Easynet Finance role-based approval policy (phase 1).
 *
 * Pure, opt-in decision layer. It does not mutate legacy document statuses,
 * permissions, accounting postings, stock movements, or database records.
 * Enforcement requires a durable approval history and authenticated actors.
 */
export const ERP_ROLES = [
  "FINANCE_OFFICER_AP", "FINANCE_OFFICER_AR", "FINANCE_CONTROLLER",
  "CFO", "INVENTORY_CONTROLLER", "INVENTORY_MANAGER",
  "SUPPLY_CHAIN_OFFICER", "SUPPLY_CHAIN_MANAGER", "CEO",
] as const;
export type ErpRole = (typeof ERP_ROLES)[number];

export const DOCUMENT_KINDS = [
  "PURCHASE_REQUISITION", "PURCHASE_ORDER", "GOODS_RECEIPT",
  "SUPPLIER_BILL", "SUPPLIER_PAYMENT", "SALES_INVOICE",
  "CUSTOMER_RECEIPT", "CUSTOMER_REFUND", "STOCK_TRANSFER",
  "STOCK_ADJUSTMENT", "STOCK_WRITE_OFF", "MANUAL_JOURNAL",
  "BANK_RECONCILIATION", "PERIOD_CLOSE",
] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];
export type WorkflowAction = "CREATE" | "EDIT" | "DELETE" | "SUBMIT" |
  "REVIEW" | "APPROVE" | "RETURN" | "CANCEL" | "REVERSE" | "RELEASE";
export type WorkflowStatus =
  "DRAFT" | "SUBMITTED" | "UNDER_REVIEW" | "APPROVED" |
  "RELEASED" | "POSTED" | "CLOSED" | "CANCELLED" | "REVERSED";
export type RiskFlag =
  "THREE_WAY_MISMATCH" | "DUPLICATE_BILL" | "SUPPLIER_BANK_CHANGED" |
  "BUDGET_OVERRUN" | "NEGATIVE_STOCK" | "PRICE_VARIANCE" | "UNUSUAL_DISCOUNT";

export type PolicyContext = {
  documentKind: DocumentKind;
  status: WorkflowStatus;
  amountPgk: number;
  actorId: string;
  creatorId: string;
  roles: readonly ErpRole[];
  reviewedBy?: readonly string[];
  approvedBy?: readonly string[];
  flags?: readonly RiskFlag[];
  hasBlockingDependency?: boolean;
};

const RULES: Record<DocumentKind, { maker: readonly ErpRole[]; reviewer: readonly ErpRole[]; approver: readonly ErpRole[] }> = {
  PURCHASE_REQUISITION: { maker: ["INVENTORY_CONTROLLER","SUPPLY_CHAIN_OFFICER"], reviewer: ["INVENTORY_MANAGER"], approver: ["SUPPLY_CHAIN_MANAGER"] },
  PURCHASE_ORDER: { maker: ["SUPPLY_CHAIN_OFFICER"], reviewer: ["SUPPLY_CHAIN_MANAGER"], approver: ["SUPPLY_CHAIN_MANAGER","CFO","CEO"] },
  GOODS_RECEIPT: { maker: ["INVENTORY_CONTROLLER"], reviewer: ["INVENTORY_MANAGER"], approver: ["INVENTORY_MANAGER"] },
  SUPPLIER_BILL: { maker: ["FINANCE_OFFICER_AP"], reviewer: ["FINANCE_CONTROLLER"], approver: ["FINANCE_CONTROLLER","CFO","CEO"] },
  SUPPLIER_PAYMENT: { maker: ["FINANCE_OFFICER_AP"], reviewer: ["FINANCE_CONTROLLER"], approver: ["FINANCE_CONTROLLER","CFO","CEO"] },
  SALES_INVOICE: { maker: ["FINANCE_OFFICER_AR"], reviewer: ["FINANCE_CONTROLLER"], approver: ["FINANCE_CONTROLLER","CFO"] },
  CUSTOMER_RECEIPT: { maker: ["FINANCE_OFFICER_AR"], reviewer: ["FINANCE_CONTROLLER"], approver: ["FINANCE_CONTROLLER"] },
  CUSTOMER_REFUND: { maker: ["FINANCE_OFFICER_AR"], reviewer: ["FINANCE_CONTROLLER"], approver: ["CFO"] },
  STOCK_TRANSFER: { maker: ["INVENTORY_CONTROLLER"], reviewer: ["INVENTORY_MANAGER"], approver: ["INVENTORY_MANAGER"] },
  STOCK_ADJUSTMENT: { maker: ["INVENTORY_CONTROLLER"], reviewer: ["INVENTORY_MANAGER"], approver: ["FINANCE_CONTROLLER","CFO"] },
  STOCK_WRITE_OFF: { maker: ["INVENTORY_CONTROLLER"], reviewer: ["INVENTORY_MANAGER","FINANCE_CONTROLLER"], approver: ["CFO","CEO"] },
  MANUAL_JOURNAL: { maker: ["FINANCE_OFFICER_AP","FINANCE_OFFICER_AR","FINANCE_CONTROLLER"], reviewer: ["FINANCE_CONTROLLER","CFO"], approver: ["FINANCE_CONTROLLER","CFO"] },
  BANK_RECONCILIATION: { maker: ["FINANCE_OFFICER_AP","FINANCE_OFFICER_AR"], reviewer: ["FINANCE_CONTROLLER"], approver: ["FINANCE_CONTROLLER","CFO"] },
  PERIOD_CLOSE: { maker: ["FINANCE_CONTROLLER"], reviewer: ["CFO"], approver: ["CFO"] },
};

export const DEFAULT_APPROVAL_LIMITS_PGK = Object.freeze({
  purchaseManager: 10_000,
  purchaseCfo: 50_000,
  executiveThreshold: 50_000,
  boardReviewThreshold: 250_000,
  stockWriteOffManager: 2_000,
  stockWriteOffCfo: 10_000,
});

export function requiredApproverRoles(
  kind: DocumentKind, amountPgk: number, flags: readonly RiskFlag[] = [],
): readonly ErpRole[] {
  if (!Number.isFinite(amountPgk) || amountPgk < 0) throw new Error("Invalid PGK amount");
  const escalation = flags.length > 0;
  switch (kind) {
    case "PURCHASE_ORDER":
      return amountPgk > DEFAULT_APPROVAL_LIMITS_PGK.purchaseCfo
        ? ["SUPPLY_CHAIN_MANAGER","CFO","CEO"]
        : amountPgk > DEFAULT_APPROVAL_LIMITS_PGK.purchaseManager || escalation
          ? ["SUPPLY_CHAIN_MANAGER","CFO"] : ["SUPPLY_CHAIN_MANAGER"];
    case "SUPPLIER_BILL":
      return amountPgk > DEFAULT_APPROVAL_LIMITS_PGK.executiveThreshold ? ["CFO","CEO"]
        : amountPgk > DEFAULT_APPROVAL_LIMITS_PGK.purchaseManager || escalation ? ["CFO"] : ["FINANCE_CONTROLLER"];
    case "SUPPLIER_PAYMENT":
      return amountPgk > DEFAULT_APPROVAL_LIMITS_PGK.executiveThreshold ? ["CFO","CEO"]
        : amountPgk > DEFAULT_APPROVAL_LIMITS_PGK.purchaseManager || escalation ? ["CFO"] : ["FINANCE_CONTROLLER"];
    case "STOCK_WRITE_OFF":
      return amountPgk > DEFAULT_APPROVAL_LIMITS_PGK.stockWriteOffCfo ? ["CFO","CEO"] : ["CFO"];
    case "STOCK_ADJUSTMENT":
      return amountPgk > DEFAULT_APPROVAL_LIMITS_PGK.stockWriteOffCfo || escalation ? ["CFO"] : ["FINANCE_CONTROLLER"];
    default:
      return RULES[kind].approver.slice(0, 1);
  }
}

export function canAct(context: PolicyContext, action: WorkflowAction): { allowed: boolean; reason: string } {
  const deny = (reason: string) => ({ allowed: false, reason });
  const allow = () => ({ allowed: true, reason: "Permitted by proposed workflow policy" });
  if (!context.actorId || !context.creatorId) return deny("Authenticated actor and document creator are required");
  if (!Number.isFinite(context.amountPgk) || context.amountPgk < 0) return deny("Invalid PGK amount");
  const rule = RULES[context.documentKind];
  if (!rule) return deny("Unsupported document kind");
  const hasRole = (permitted: readonly ErpRole[]) => context.roles.some((r) => permitted.includes(r));
  if (action === "CREATE") return hasRole(rule.maker) ? allow() : deny("Role cannot create this document");
  if (action === "EDIT" || action === "DELETE" || action === "SUBMIT") {
    if (context.status !== "DRAFT") return deny("Only drafts may be edited, deleted or submitted");
    if (context.actorId !== context.creatorId || !hasRole(rule.maker)) return deny("Only the permitted creator can change this draft");
    if (action === "DELETE" && context.hasBlockingDependency) return deny("Draft has a blocking downstream dependency");
    return allow();
  }
  if (action === "REVIEW" || action === "RETURN") {
    if (!["SUBMITTED","UNDER_REVIEW"].includes(context.status)) return deny("Document is not under review");
    if (context.actorId === context.creatorId) return deny("Maker cannot review their own document");
    return hasRole(rule.reviewer) ? allow() : deny("Role cannot review this document");
  }
  if (action === "APPROVE") {
    if (context.status !== "UNDER_REVIEW") return deny("Document must be reviewed before approval");
    if (context.actorId === context.creatorId) return deny("Self-approval is prohibited");
    if ((context.reviewedBy || []).includes(context.actorId)) return deny("Reviewer cannot approve the same document");
    if (!(context.reviewedBy || []).length) return deny("Independent review evidence is required");
    const required = requiredApproverRoles(context.documentKind, context.amountPgk, context.flags);
    const approved = context.approvedBy || [];
    const nextRole = required.find((_, i) => i >= approved.length);
    if (!nextRole) return deny("Required approvals already completed");
    if (!context.roles.includes(nextRole)) return deny(`Next approver must have role ${nextRole}`);
    if (approved.includes(context.actorId)) return deny("One user cannot sign multiple approval steps");
    if ((context.flags || []).length) return deny("Blocking risk exceptions require separately recorded resolution");
    return allow();
  }
  if (action === "CANCEL") return ["DRAFT","SUBMITTED","UNDER_REVIEW","APPROVED"].includes(context.status)
    && context.actorId === context.creatorId ? allow() : deny("Cancellation must be authorised by a separate workflow");
  if (action === "RELEASE" || action === "REVERSE") return deny("Posting/reversal requires document-specific backend controls");
  return deny("Unsupported action");
}
