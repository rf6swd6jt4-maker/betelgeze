import { Suspense } from "react"
import NativeRelationshipsPanel from "@/components/workspace/NativeRelationshipsPanel"
import { WorkspaceTopBar } from "@/components/workspace/WorkspaceTopBar"
import { RelationshipContextBridge } from "@/components/workspace/RelationshipContextBridge"
import { loadNativeRelationships } from "@/lib/workspace-native-relationships"
import { requireWorkspacePanel } from "@/lib/workspace-access"
export const dynamic = "force-dynamic"
async function Contents({ authorization, relationshipId }: { authorization: Awaited<ReturnType<typeof requireWorkspacePanel>>; relationshipId?: string }) {
    const { workspace, access } = authorization
    const data = await loadNativeRelationships(workspace.slug, relationshipId, authorization)
    return <><NativeRelationshipsPanel data={data} />{data.context ? <RelationshipContextBridge workspaceSlug={workspace.slug} contextPayload={data.context} workspaceCapabilities={access.capabilities} /> : null}</>
}
export default async function RelationshipPage({ params }: {params: Promise<{ workspaceSlug: string }>}) {
    const route = await params
    const authorization = await requireWorkspacePanel(route.workspaceSlug, "relationships")
    return <>
        <WorkspaceTopBar userId={authorization.user.id} workspace={authorization.workspace} workspaceAccess={authorization.access} currentProduct="client-work" />
        <Suspense fallback={<div className="px-4 py-6 text-sm text-neutral-500" role="status">Loading relationships…</div>}><Contents authorization={authorization} /></Suspense>
    </>
}
