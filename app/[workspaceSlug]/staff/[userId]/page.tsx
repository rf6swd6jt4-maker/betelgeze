import { notFound } from "next/navigation"
import { DetailDangerAction, DetailDangerZone, DetailField, DetailFields, DetailPageHeader } from "@/components/detail"
import { Assignee } from "@/components/ui"
import { RemoveWorkspaceUser } from "@/components/admin/RemoveWorkspaceUser"
import { StaffMemberAssignments } from "@/components/staff/StaffMemberAssignments"
import { WorkspaceTopBar } from "@/components/workspace/WorkspaceTopBar"
import { removeWorkspaceUser } from "@/app/[workspaceSlug]/users/actions"
import { loadMemberFootprint } from "@/lib/staff-server"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { formatRelativeTime, shortId } from "@/lib/ui/relative-time"
import { normalizeWorkspaceRole, workspaceRoleLabel } from "@/lib/workspace-roles"
import { requireWorkspace } from "@/lib/workspaces"

export const dynamic = "force-dynamic"

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function StaffMemberPage({ params }: { params: Promise<{ workspaceSlug: string; userId: string }> }) {
    const { workspaceSlug, userId } = await params
    if (!UUID.test(userId)) notFound()
    const { workspace, user, role: actorRole } = await requireWorkspace(workspaceSlug, "admin")
    const [footprint, membership, authUser] = await Promise.all([
        loadMemberFootprint(workspace.id, user.id, userId),
        supabaseAdmin.from("workspace_memberships").select("role, created_at").eq("workspace_id", workspace.id).eq("user_id", userId).maybeSingle(),
        supabaseAdmin.auth.admin.getUserById(userId),
    ])
    if (membership.error) throw new Error("Could not load this person.")
    const member = membership.data
    if (!member && (!footprint.available || footprint.items.length === 0)) notFound()

    const name = footprint.available ? footprint.targetName : authUser.data.user?.email ?? "Workspace member"
    const role = member ? normalizeWorkspaceRole(member.role) : null
    const email = authUser.data.user?.email ?? "this person"
    const canRemove = !!member && role !== "owner" && userId !== user.id && (actorRole === "owner" || role === "staff")

    return <main className="min-h-screen max-w-full overflow-x-clip bg-neutral-950 px-4 pb-8 text-white sm:px-6">
        <WorkspaceTopBar userId={user.id} workspace={workspace} currentProduct="client-work" />
        <div className="mx-auto max-w-[92rem] pt-6">
            <DetailPageHeader category="Staff member" reference={shortId(userId)} title={name}
                subtitle={member ? workspaceRoleLabel(member.role) : "No longer in this workspace"}
                facts={footprint.available ? [{ label: footprint.items.length === 1 ? "assignment" : "assignments", value: footprint.items.length }] : []}
                updated="just now" />
            <DetailFields>
                <DetailField label="Person" icon="person"><Assignee name={name} /></DetailField>
                <DetailField label="Role" icon="role" className="lg:border-l lg:pl-8">{member ? workspaceRoleLabel(member.role) : "Removed"}</DetailField>
                {member ? <DetailField label="Joined" icon="schedule">{formatRelativeTime(member.created_at)} ago</DetailField> : null}
                {footprint.available && footprint.history.sellerClients ? <DetailField label="Seller on" icon="company" className="lg:border-l lg:pl-8">
                    {footprint.history.sellerClients} client{footprint.history.sellerClients === 1 ? "" : "s"} (kept as history)</DetailField> : null}
            </DetailFields>
            <div className="mt-8">
                {footprint.available
                    ? <StaffMemberAssignments workspaceSlug={workspace.slug} currentUserId={user.id} initial={footprint} />
                    : <p role="status" className="text-sm text-neutral-400">Moving assignments needs a database update that has not been applied yet.</p>}
            </div>
            {canRemove ? <DetailDangerZone>
                <DetailDangerAction title="Reassign and remove"
                    description="Move everything this person holds to others and remove them from the workspace in one step. If anything fails, nothing changes."
                    control={<RemoveWorkspaceUser workspaceSlug={workspace.slug} currentUserId={user.id} userId={userId} email={email} legacyAction={removeWorkspaceUser.bind(null, workspace.slug)} />} />
            </DetailDangerZone> : null}
        </div>
    </main>
}
