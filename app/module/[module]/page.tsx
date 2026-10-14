import { notFound, redirect } from "next/navigation";
import { getCurrentUser, hasPermission } from "@/lib/auth";
import { groups } from "@/lib/navigation/sidebar-groups";
import { getSetupGateState } from "@/lib/setup-gate";
import UnifiedModuleWorkspace from "@/app/components/unified-module-workspace";
import { workspaces, workspaceIds, type WorkspaceAction, type WorkspaceDefinition, type WorkspaceId } from "@/lib/workspaces/module-registry";
import { recentWorkspaceDocuments } from "@/lib/workspaces/recent-documents.server";

export const dynamic = "force-dynamic";

const moduleWorkspaces: Record<string, WorkspaceId> = {
  dashboard: "home",
  sales: "sales",
  purchase: "purchases",
  "stock-assets": "inventory",
  accounts: "accounting",
  projects: "projects",
  reports: "reports",
};

function slug(label: string) {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

function sectionFor(label: string, module: string) {
  if (module === "administration") {
    if (/backup|recovery|go-live|import/i.test(label)) return "System Controls";
    if (/user|permission/i.test(label)) return "Security";
    return "Settings";
  }
  if (module === "documents-ai") return /ai|upload/i.test(label) ? "AI Tools" : "Documents";
  if (module === "dashboard") return /approval/i.test(label) ? "Approvals" : "Overview";
  if (/bank|cash|payment|receipt/i.test(label)) return "Banking & Payments";
  if (/project/i.test(label)) return "Projects";
  if (/report|statement|trial|gst/i.test(label)) return "Reports";
  if (/setting|control|close/i.test(label)) return "Controls";
  return "Registers";
}

export default async function ModuleMenuPage({ params }: { params: Promise<{ module: string }> }) {
  const { module } = await params;
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const group = groups.find(item => slug(item.label) === module && item.label !== "Home");
  if (!group) notFound();

  const permittedLinks = group.links.filter(([, , permission]) => hasPermission(user, permission));
  if (!permittedLinks.length) notFound();

  const { openingSubledgerLocked } = await getSetupGateState();
  const id = moduleWorkspaces[module];
  const configured = id ? workspaces[id] : null;

  const mainActions = configured
    ? configured.actions.filter(action => hasPermission(user, action.permission))
    : [];

  // Reuse existing workspace workflows and retain every role-permitted sidebar destination.
  // The current workspace shortcut is omitted because this page IS the module workspace.
  const existingHrefs = new Set(mainActions.map(action => action.href));
  const extraActions: WorkspaceAction[] = permittedLinks
    .filter(([label, href]) => !/ Workspace$/.test(label) && !existingHrefs.has(href))
    .map(([label, href, permission]) => ({
      title: label,
      description: "Open " + label.toLowerCase(),
      href,
      section: sectionFor(label, module),
      permission,
      disabled: href === "/migration/opening-subledger" && openingSubledgerLocked,
      disabledReason: "Opening AR/AP import is locked for the current company setup.",
    }));

  const actions = [...mainActions, ...extraActions].map(action =>
    action.href === "/migration/opening-subledger" && openingSubledgerLocked
      ? { ...action, disabled: true, disabledReason: "Opening AR/AP import is locked for the current company setup." }
      : action
  );

  const workspace: WorkspaceDefinition = configured
    ? { ...configured, title: module === "dashboard" ? "Dashboard Workspace" : configured.title }
    : {
        id: "home",
        title: group.label + " Workspace",
        eyebrow: "EASYNET FINANCE / " + group.label.toUpperCase(),
        description: "Search and open your permitted " + group.label.toLowerCase() + " functions and registers.",
        permission: permittedLinks[0][2],
        actions,
      };

  const recentDocuments = id === "purchases" || id === "sales"
    ? await recentWorkspaceDocuments(id)
    : [];
  const availableModules = workspaceIds
    .filter(workspaceId => hasPermission(user, workspaces[workspaceId].permission))
    .map(workspaceId => ({ id: workspaceId, title: workspaces[workspaceId].title }));

  return <UnifiedModuleWorkspace
    workspace={workspace}
    actions={actions}
    availableModules={availableModules}
    recentDocuments={recentDocuments}
    streamlined
  />;
}
