import { requirePermission } from "@/lib/auth";
import SalesBulkProcessingClient from "@/app/components/sales-bulk-processing-client";
export default async function SalesBulkProcessingPage(){
  await requirePermission("sales.read");
  return <SalesBulkProcessingClient/>;
}
