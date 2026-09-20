import MasterDoctypeClient from "@/app/components/master-doctype-client";

export const dynamic = "force-dynamic";

export default function CustomersPage() {
  return (
    <MasterDoctypeClient
      type="customer"
      title="Customers"
      description="Customer master doctype used by Sales Quotations, Sales Invoices, receipts, AR ledger, and customer reports."
      createLabel="+ Create New Customer"
    />
  );
}
