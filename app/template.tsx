"use client";

import { useEffect } from "react";

/** This template remounts on route navigation, unlike the persistent root layout. */
export default function RouteTemplate({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    window.dispatchEvent(new Event("ef:route-ready"));
  }, []);
  return <>{children}</>;
}
