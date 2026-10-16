import { requirePermission } from "@/lib/auth";
import PurchaseBulkReceiptsClient from "@/app/components/purchase-bulk-receipts-client";
export default async function PurchaseBulkReceiptsPage(){await requirePermission("purchase.read");return <PurchaseBulkReceiptsClient/>;}
