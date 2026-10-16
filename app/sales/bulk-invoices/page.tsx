import { requirePermission } from "@/lib/auth";
import BulkInvoiceClient from "@/app/components/sales-bulk-invoices-client";
export default async function SalesBulkInvoicesPage(){await requirePermission("sales.read");return <BulkInvoiceClient/>;}
