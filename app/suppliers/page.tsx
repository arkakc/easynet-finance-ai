import MasterDoctypeClient from "@/app/components/master-doctype-client";

export const dynamic = "force-dynamic";

export default function SuppliersPage() {
  return (
    <MasterDoctypeClient
      type="supplier"
      title="Suppliers"
      description="Supplier master doctype used by Purchase Orders, Supplier Invoices, supplier payments, AP ledger, and purchase reports."
      createLabel="+ Create New Supplier"
    />
  );
}
