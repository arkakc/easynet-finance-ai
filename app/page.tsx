import { redirect } from "next/navigation";
import { getSetupGateState } from "@/lib/setup-gate";

export default async function Home() {
  const { setupActive } = await getSetupGateState();
  redirect(setupActive ? "/dashboard" : "/setup/finance");
}
