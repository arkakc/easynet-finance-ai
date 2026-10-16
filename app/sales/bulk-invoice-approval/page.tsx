import { requirePermission } from "@/lib/auth";
import BulkInvoiceApprovalClient from "@/app/components/bulk-invoice-approval-client";
export default async function BulkInvoiceApprovalPage(){await requirePermission("post.approve");return <BulkInvoiceApprovalClient/>;}
