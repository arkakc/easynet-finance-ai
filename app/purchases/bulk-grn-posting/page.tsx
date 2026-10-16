import { requirePermission } from "@/lib/auth";
import BulkGrnPostingClient from "@/app/components/purchase-bulk-grn-posting-client";
export default async function BulkGrnPostingPage(){await requirePermission("post.approve");await requirePermission("purchase.write");return <BulkGrnPostingClient/>;}
