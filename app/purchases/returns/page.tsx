import { requirePermission } from "@/lib/auth";
import PurchaseReturnsClient from "@/app/components/purchase-returns-client";
export default async function PurchaseReturnsPage() { await requirePermission("purchase.read"); return <PurchaseReturnsClient />; }
