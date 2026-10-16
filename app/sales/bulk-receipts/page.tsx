import { requirePermission } from "@/lib/auth";
import BulkReceiptsClient from "@/app/components/bulk-customer-receipts-client";

export default async function BulkReceiptsPage(){
 await requirePermission("sales.write");
 return <BulkReceiptsClient/>;
}
