import {requirePermission} from "@/lib/auth";
import PurchaseBulkInvoicesClient from "@/app/components/purchase-bulk-invoices-client";
export default async function PurchaseBulkInvoicesPage(){await requirePermission("purchase.read");return <PurchaseBulkInvoicesClient/>;}
