import { notFound } from "next/navigation";
import { getCurrentUser, hasPermission, requirePermission } from "@/lib/auth";
import UnifiedModuleWorkspace from "@/app/components/unified-module-workspace";
import { workspaceFor, workspaceIds, workspaces } from "@/lib/workspaces/module-registry";
import { recentWorkspaceDocuments } from "@/lib/workspaces/recent-documents.server";

export const dynamic = "force-dynamic";

export default async function WorkspacePage({ params }: { params: Promise<{ module: string }> }) {
  const { module } = await params;
  const workspace = workspaceFor(module);
  if (!workspace) notFound();
  await requirePermission(workspace.permission);
  const user = await getCurrentUser();
  const actions = workspace.actions.filter(action => hasPermission(user, action.permission));
  const recentDocuments = await recentWorkspaceDocuments(workspace.id);
  const availableModules = workspaceIds
    .filter(id => hasPermission(user, workspaces[id].permission))
    .map(id => ({ id, title: workspaces[id].title }));
  return <UnifiedModuleWorkspace workspace={workspace} actions={actions} availableModules={availableModules} recentDocuments={recentDocuments} />;
}
