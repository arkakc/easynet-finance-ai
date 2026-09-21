import { requirePermission } from "@/lib/auth";
import WarehouseStockClient from "@/app/components/warehouse-stock-client";

export default async function WarehouseStockPage() {
  await requirePermission("stock.read");
  return <WarehouseStockClient />;
}
