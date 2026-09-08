import TransactionsWorkspaceV5 from "@/app/components/transactions-workspace-v5";
import TransactionListEditEnhancer from "@/app/components/transaction-list-edit-enhancer";

export default function TransactionsPage() {
  return <>
    <TransactionListEditEnhancer />
    <TransactionsWorkspaceV5 />
  </>;
}
