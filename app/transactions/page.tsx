import TransactionsWorkspaceV4 from "@/app/components/transactions-workspace-v4";
import TransactionListEditEnhancer from "@/app/components/transaction-list-edit-enhancer";

export default function TransactionsPage() {
  return <>
    <TransactionListEditEnhancer />
    <TransactionsWorkspaceV4 />
  </>;
}
