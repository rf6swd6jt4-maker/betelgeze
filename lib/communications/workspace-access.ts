import "server-only"
import { notFound } from "next/navigation"
import { requireWorkspace } from "@/lib/workspaces"
import { canAccessWorkspacePanel, workspacePanelByKey } from "@/lib/workspace-panels"
import { markChatBoundary } from "./performance-server"

/** Communications is an all-member panel. Keep verified auth/MFA, active
 * workspace and membership checks; service configuration is unrelated here.
 * Every caller must still authorize its individual conversation operation.
 */
export async function requireCommunicationsWorkspace(slug: string) {
    const context = await requireWorkspace(slug)
    if (!canAccessWorkspacePanel(workspacePanelByKey("communications"), context.role, [])) notFound()
    markChatBoundary("access_ready")
    return context
}
