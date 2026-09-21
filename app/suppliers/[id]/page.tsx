import MasterDoctypeDetailClient from "@/app/components/master-doctype-detail-client";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

export default async function SupplierDetailPage({ params }: Props) {
  const { id } = await params;
  return <MasterDoctypeDetailClient type="supplier" recordId={decodeURIComponent(id)} />;
}
