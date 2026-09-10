import { WorkspaceBanner } from "@/components/admin/WorkspaceBanner"
import { requireWorkspace } from "@/lib/workspaces"

export async function WorkspaceNativeBanner({ workspaceSlug }: { workspaceSlug: string }) {
    const { workspace } = await requireWorkspace(workspaceSlug)
    return <WorkspaceBanner bannerPath={workspace.banner_path} logoPath={workspace.logo_path} name={workspace.name} height={workspace.banner_height} position={workspace.banner_position} />
}
