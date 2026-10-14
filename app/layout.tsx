import "./globals.css";
import "./busy-controls.css";
import { getCurrentUser, hasPermission } from "@/lib/auth";
import FlowReturnBridge from "@/app/components/flow-return-bridge";
import SetupAccessGuard from "@/app/components/setup-access-guard";
import SidebarShell from "@/app/components/sidebar-shell";
import NavigationTransitionGuard from "@/app/components/navigation-transition-guard";
import ProfileMenu from "@/app/components/profile-menu";
import { type SidebarNavGroup } from "@/app/components/collapsible-sidebar-nav";
import GlobalDataTableEnhancer from "@/app/components/global-data-table-enhancer";
import GlobalFormDraftCache from "@/app/components/global-form-draft-cache";
import { getSetupGateState } from "@/lib/setup-gate";
import { groups } from "@/lib/navigation/sidebar-groups";

export const metadata = {
  title: "Easynet Finance AI",
  description: "Finance control and AI accounting automation for Easynet IT Solutions Limited",
  robots: { index: false, follow: false, noarchive: true },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  const { setupActive, openingSubledgerLocked } = user ? await getSetupGateState() : { setupActive: true, openingSubledgerLocked: false };
  const navGroups: SidebarNavGroup[] = !user ? [] : !setupActive ? [
    { label: "System Setup", icon: "⚙️", links: [{ label: "Fresh Setup Wizard", href: "/setup/finance" }] },
  ] : groups.flatMap((group) => {
    const visible = group.links
      .filter(([, , permission]) => hasPermission(user, permission))
      .map(([label, href]) => ({
        label,
        href,
        disabled: href === "/migration/opening-subledger" && openingSubledgerLocked,
        disabledReason: "Disabled because the system was activated as a new business with zero opening balances. Full reset is required to enable opening AR/AP import again.",
      }));
    return visible.length ? [{ label: group.label, icon: group.icon, links: visible }] : [];
  });
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
      </head>
      <body>
        {!user ? (
          children
        ) : (
          <div className="shell">
            <SidebarShell
              groups={navGroups}
              homeHref={setupActive ? "/home" : "/setup/finance"}
            />
            <ProfileMenu userName={user.name} userRoles={user.roles} />
            <NavigationTransitionGuard />
            <main className="main">
              <SetupAccessGuard setupActive={setupActive} />
              <FlowReturnBridge />
              <GlobalDataTableEnhancer />
              <GlobalFormDraftCache />
              {children}
            </main>
          </div>
        )}
      </body>
    </html>
  );
}
