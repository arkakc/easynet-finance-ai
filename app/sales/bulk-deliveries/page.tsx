import { requirePermission } from "@/lib/auth";
import SalesBulkDeliveriesClient from "@/app/components/sales-bulk-deliveries-client";

export default async function BulkDeliveriesPage(){
 await requirePermission("sales.read");
 return <SalesBulkDeliveriesClient />;
}
