"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";

const SETUP_ALLOWED_PATHS = new Set([
  "/setup/finance",
  "/migration/opening-subledger",
]);

export default function SetupAccessGuard({ setupActive }: { setupActive: boolean }) {
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (setupActive || SETUP_ALLOWED_PATHS.has(pathname)) return;
    router.replace("/setup/finance");
  }, [pathname, router, setupActive]);

  return null;
}
