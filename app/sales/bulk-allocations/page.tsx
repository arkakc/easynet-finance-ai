import { requirePermission } from "@/lib/auth";
import BulkCustomerAllocationsClient from "@/app/components/bulk-customer-allocations-client";
export default async function BulkCustomerAllocationsPage(){await requirePermission("sales.read");return <BulkCustomerAllocationsClient/>;}
