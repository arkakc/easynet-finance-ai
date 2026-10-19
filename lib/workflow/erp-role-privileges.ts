import { DOCUMENT_KINDS, ERP_ROLES, type DocumentKind, type ErpRole } from "./erp-approval-policy";

export const ACCOUNTING_FUNCTIONS = [
  "CHART_OF_ACCOUNTS", "JOURNAL_ENTRY", "GENERAL_LEDGER", "AP_LEDGER",
  "AR_LEDGER", "PAYMENT_ALLOCATION", "BANK_RECONCILIATION",
  "GST_REPORTING", "FINANCIAL_REPORTING", "PERIOD_CLOSE",
  "INVENTORY_VALUATION", "PURCHASE_COMMITMENT",
] as const;
export type AccountingFunction = typeof ACCOUNTING_FUNCTIONS[number];
export const PRIVILEGE_ACTIONS = [
  "READ", "CREATE", "EDIT_DRAFT", "DELETE_DRAFT", "SUBMIT",
  "REVIEW", "APPROVE", "POST", "REVERSE", "EXPORT",
] as const;
export type PrivilegeAction = typeof PRIVILEGE_ACTIONS[number];
export type PrivilegeResource =
  | { kind: "DOCTYPE"; name: DocumentKind }
  | { kind: "ACCOUNTING"; name: AccountingFunction };

type Grant = { read?: readonly string[]; entry?: readonly string[]; review?: readonly string[]; approve?: readonly string[]; post?: readonly string[]; reverse?: readonly string[] };
const DOCUMENT_GRANTS: Record<DocumentKind, Grant> = {
  PURCHASE_REQUISITION: { entry:["INVENTORY_CONTROLLER","SUPPLY_CHAIN_OFFICER"],review:["INVENTORY_MANAGER"],approve:["SUPPLY_CHAIN_MANAGER"] },
  PURCHASE_ORDER: { entry:["SUPPLY_CHAIN_OFFICER"],review:["SUPPLY_CHAIN_MANAGER"],approve:["SUPPLY_CHAIN_MANAGER","CFO","CEO"] },
  GOODS_RECEIPT: { entry:["INVENTORY_CONTROLLER"],review:["INVENTORY_MANAGER"],approve:["INVENTORY_MANAGER"] },
  SUPPLIER_BILL: { entry:["FINANCE_OFFICER_AP"],review:["FINANCE_CONTROLLER"],approve:["FINANCE_CONTROLLER","CFO","CEO"],post:["FINANCE_CONTROLLER"] },
  SUPPLIER_PAYMENT: { entry:["FINANCE_OFFICER_AP"],review:["FINANCE_CONTROLLER"],approve:["FINANCE_CONTROLLER","CFO","CEO"],post:["FINANCE_CONTROLLER"] },
  SALES_INVOICE: { entry:["FINANCE_OFFICER_AR"],review:["FINANCE_CONTROLLER"],approve:["FINANCE_CONTROLLER","CFO"],post:["FINANCE_CONTROLLER"] },
  CUSTOMER_RECEIPT: { entry:["FINANCE_OFFICER_AR"],review:["FINANCE_CONTROLLER"],approve:["FINANCE_CONTROLLER"],post:["FINANCE_CONTROLLER"] },
  CUSTOMER_REFUND: { entry:["FINANCE_OFFICER_AR"],review:["FINANCE_CONTROLLER"],approve:["CFO"],post:["FINANCE_CONTROLLER"] },
  STOCK_TRANSFER: { entry:["INVENTORY_CONTROLLER"],review:["INVENTORY_MANAGER"],approve:["INVENTORY_MANAGER"] },
  STOCK_ADJUSTMENT: { entry:["INVENTORY_CONTROLLER"],review:["INVENTORY_MANAGER"],approve:["FINANCE_CONTROLLER","CFO"] },
  STOCK_WRITE_OFF: { entry:["INVENTORY_CONTROLLER"],review:["INVENTORY_MANAGER","FINANCE_CONTROLLER"],approve:["CFO","CEO"] },
  MANUAL_JOURNAL: { entry:["FINANCE_OFFICER_AP","FINANCE_OFFICER_AR","FINANCE_CONTROLLER"],review:["FINANCE_CONTROLLER","CFO"],approve:["FINANCE_CONTROLLER","CFO"],post:["FINANCE_CONTROLLER"] },
  BANK_RECONCILIATION: { entry:["FINANCE_OFFICER_AP"],review:["FINANCE_CONTROLLER"],approve:["FINANCE_CONTROLLER"] },
  PERIOD_CLOSE: { entry:["FINANCE_CONTROLLER"],review:["CFO"],approve:["CFO","CEO"] },
};
const ACCOUNTING_GRANTS: Record<AccountingFunction, Grant> = {
  CHART_OF_ACCOUNTS: { read:["FINANCE_OFFICER_AP","FINANCE_OFFICER_AR","FINANCE_CONTROLLER","CFO","CEO"],entry:["FINANCE_CONTROLLER"],review:["CFO"],approve:["CFO"] },
  JOURNAL_ENTRY: { entry:["FINANCE_OFFICER_AP","FINANCE_OFFICER_AR","FINANCE_CONTROLLER"],review:["FINANCE_CONTROLLER","CFO"],approve:["FINANCE_CONTROLLER","CFO"],post:["FINANCE_CONTROLLER"] },
  GENERAL_LEDGER: { read:["FINANCE_OFFICER_AP","FINANCE_OFFICER_AR","FINANCE_CONTROLLER","CFO","CEO"] },
  AP_LEDGER: { read:["FINANCE_OFFICER_AP","FINANCE_CONTROLLER","CFO","CEO"] },
  AR_LEDGER: { read:["FINANCE_OFFICER_AR","FINANCE_CONTROLLER","CFO","CEO"] },
  PAYMENT_ALLOCATION: { entry:["FINANCE_OFFICER_AP","FINANCE_OFFICER_AR"],review:["FINANCE_CONTROLLER"],approve:["FINANCE_CONTROLLER"],post:["FINANCE_CONTROLLER"] },
  BANK_RECONCILIATION: { entry:["FINANCE_OFFICER_AP"],review:["FINANCE_CONTROLLER"],approve:["FINANCE_CONTROLLER"] },
  GST_REPORTING: { read:["FINANCE_OFFICER_AP","FINANCE_OFFICER_AR","FINANCE_CONTROLLER","CFO","CEO"],entry:["FINANCE_CONTROLLER"],review:["CFO"] },
  FINANCIAL_REPORTING: { read:["FINANCE_CONTROLLER","CFO","CEO"] },
  PERIOD_CLOSE: { entry:["FINANCE_CONTROLLER"],review:["CFO"],approve:["CFO","CEO"] },
  INVENTORY_VALUATION: { read:["INVENTORY_MANAGER","FINANCE_CONTROLLER","CFO","CEO"] },
  PURCHASE_COMMITMENT: { read:["SUPPLY_CHAIN_MANAGER","FINANCE_CONTROLLER","CFO","CEO"] },
};
const ROLE_SET = new Set<string>(ERP_ROLES);
const DOCUMENT_SET = new Set<string>(DOCUMENT_KINDS);
const ACCOUNTING_SET = new Set<string>(ACCOUNTING_FUNCTIONS);
function permitted(grant: Grant, role: ErpRole, action: PrivilegeAction) {
  switch (action) {
    case "READ": case "EXPORT":
      return [grant.read,grant.entry,grant.review,grant.approve,grant.post].some(a=>a?.includes(role));
    case "CREATE": case "EDIT_DRAFT": case "DELETE_DRAFT": case "SUBMIT":
      return !!grant.entry?.includes(role);
    case "REVIEW": return !!grant.review?.includes(role);
    case "APPROVE": return !!grant.approve?.includes(role);
    case "POST": return !!grant.post?.includes(role);
    case "REVERSE": return !!grant.reverse?.includes(role);
  }
}
/** Default-deny capability matrix. Does not override independent approval,
 * posting, financial period, document status or tenant checks.
 */
export function hasErpPrivilege(roles: readonly string[], resource: PrivilegeResource, action: PrivilegeAction): boolean {
  if (!roles.length || !resource || !PRIVILEGE_ACTIONS.includes(action)) return false;
  if (resource.kind === "DOCTYPE" && !DOCUMENT_SET.has(resource.name)) return false;
  if (resource.kind === "ACCOUNTING" && !ACCOUNTING_SET.has(resource.name)) return false;
  if (resource.kind !== "DOCTYPE" && resource.kind !== "ACCOUNTING") return false;
  const grant = resource.kind === "DOCTYPE" ? DOCUMENT_GRANTS[resource.name] : ACCOUNTING_GRANTS[resource.name];
  return roles.some(role=>ROLE_SET.has(role) && permitted(grant,role as ErpRole,action));
}
export function listRolePrivileges(role: ErpRole) {
  return {
    documentTypes: DOCUMENT_KINDS.map(name=>({name,actions:PRIVILEGE_ACTIONS.filter(action=>hasErpPrivilege([role],{kind:"DOCTYPE",name},action))})).filter(item=>item.actions.length),
    accountingFunctions: ACCOUNTING_FUNCTIONS.map(name=>({name,actions:PRIVILEGE_ACTIONS.filter(action=>hasErpPrivilege([role],{kind:"ACCOUNTING",name},action))})).filter(item=>item.actions.length),
  };
}
