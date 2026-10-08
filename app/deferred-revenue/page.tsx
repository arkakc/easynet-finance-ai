import { requirePermission } from "@/lib/auth";
import DeferredRevenueWorkspace from "@/app/components/deferred-revenue-workspace";

export default async function DeferredRevenuePage() {
  await requirePermission("post.approve");
  return <DeferredRevenueWorkspace />;
}
