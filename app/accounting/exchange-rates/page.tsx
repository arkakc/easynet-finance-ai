import { requirePermission } from "@/lib/auth";
import ExchangeRatesClient from "@/app/components/exchange-rates-client";

export default async function ExchangeRatesPage() {
  await requirePermission("accounts.read");
  return <ExchangeRatesClient />;
}
