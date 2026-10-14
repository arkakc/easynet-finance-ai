import { requirePermission } from "@/lib/auth";
import SalesReturnsClient from "@/app/components/sales-returns-client";

export default async function SalesReturnsPage() {
  await requirePermission("sales.read");
  return <SalesReturnsClient />;
}
