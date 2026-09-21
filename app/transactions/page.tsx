import { Suspense } from "react";
import TransactionsWorkspaceV5 from "@/app/components/transactions-workspace-v5";
import TransactionListEditEnhancer from "@/app/components/transaction-list-edit-enhancer";

export default function TransactionsPage() {
  return <>
    <TransactionListEditEnhancer />
    <Suspense fallback={<section className="panel"><strong>Loading transaction workspace…</strong></section>}>
      <TransactionsWorkspaceV5 />
    </Suspense>
  </>;
}
