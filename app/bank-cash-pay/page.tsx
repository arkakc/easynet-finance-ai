import { requirePermission } from "@/lib/auth";
import BankCashPayEntryClient from "@/app/components/bank-cash-pay-entry-client";

export const dynamic = "force-dynamic";

export default async function BankCashPayPage() {
  await requirePermission("accounts.write");
  return (
    <>
      <div className="page-head">
        <div>
          <h2>Bank / Cash Pay Entry</h2>
          <p className="small">Payment source document · approval-controlled posting to cash/bank ledger and target expense/AP/liability ledgers.</p>
        </div>
      </div>
      <BankCashPayEntryClient />
    </>
  );
}
