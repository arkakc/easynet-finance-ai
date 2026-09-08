import TransactionDocumentClient from "@/app/components/transaction-document-client";

export default async function TransactionDocumentPage({ params }: { params: Promise<{ type: string; id: string }> }) {
  const { type, id } = await params;
  return <TransactionDocumentClient type={type} id={id} />;
}
