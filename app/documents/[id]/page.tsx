import SourceDocumentClient from "@/app/components/source-document-client";

export default async function SourceDocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <SourceDocumentClient documentId={id} />;
}
