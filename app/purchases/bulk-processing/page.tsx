import { requirePermission } from "@/lib/auth";
import PurchaseBulkProcessingClient from "@/app/components/purchase-bulk-processing-client";
export default async function PurchaseBulkProcessingPage(){await requirePermission("purchase.read");return <PurchaseBulkProcessingClient/>;}
