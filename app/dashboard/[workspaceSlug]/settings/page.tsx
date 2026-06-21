import { supabaseAdmin } from "@/lib/supabase/admin"
import { requireWorkspace } from "@/lib/workspaces"
import { createUploadSignedUrl } from "@/lib/onboarding/uploads"
import { WorkspaceIdentityEditor } from "@/components/admin/WorkspaceIdentityEditor"
import { inviteWorkspaceUser, removeWorkspaceUser, updateWorkspaceUserRole } from "../users/actions"
import { updateWorkspaceCoverLayout, updateWorkspaceName, uploadWorkspaceBanner, uploadWorkspaceLogo } from "./actions"

export const dynamic = "force-dynamic"
type PageProps = { params: Promise<{ workspaceSlug: string }> }

export default async function SettingsPage({ params }: PageProps) {
    const { workspaceSlug } = await params
    const { workspace, role } = await requireWorkspace(workspaceSlug, "admin")
    const [bannerSrc, logoSrc, membershipsResult] = await Promise.all([
        workspace.banner_path ? createUploadSignedUrl(workspace.banner_path) : null,
        workspace.logo_path ? createUploadSignedUrl(workspace.logo_path) : null,
        supabaseAdmin.from("workspace_memberships").select("user_id, role, created_at").eq("workspace_id", workspace.id).order("created_at"),
    ])
    const users = await Promise.all((membershipsResult.data ?? []).map(async (membership) => ({ ...membership, user: (await supabaseAdmin.auth.admin.getUserById(membership.user_id)).data.user })))
    const isOwner = role === "owner"

    return <main className="min-h-screen bg-neutral-950 px-4 py-5 text-white sm:px-6 sm:py-6"><div className="mx-auto max-w-7xl"><WorkspaceIdentityEditor workspace={{ name: workspace.name, slug: workspace.slug, bannerHeight: workspace.banner_height, bannerPosition: workspace.banner_position, bannerSrc, logoSrc }} updateName={updateWorkspaceName.bind(null, workspace.slug)} updateCoverLayout={updateWorkspaceCoverLayout.bind(null, workspace.slug)} uploadBanner={uploadWorkspaceBanner.bind(null, workspace.slug)} uploadLogo={uploadWorkspaceLogo.bind(null, workspace.slug)} /><section className="mt-8"><div><h2 className="text-lg font-semibold">Users</h2><p className="mt-1 text-sm text-neutral-400">Invite and manage workspace access.</p></div><form action={inviteWorkspaceUser.bind(null, workspace.slug)} className="mt-4 grid gap-3 rounded-2xl border border-neutral-800 bg-neutral-900 p-4 sm:grid-cols-[1fr_auto_auto] sm:p-5"><input name="email" type="email" required placeholder="person@business.com" className="rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2" /><select name="role" defaultValue="member" className="rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2"><option value="member">Member</option>{isOwner && <option value="admin">Admin</option>}</select><button className="rounded-lg bg-white px-4 py-2 font-medium text-black">Invite user</button></form><div className="mt-5 overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-900">{users.map(({ user, role: memberRole }) => <div key={user?.id} className="flex flex-col gap-3 border-b border-neutral-800 p-4 last:border-0 sm:flex-row sm:items-center sm:justify-between sm:p-5"><div><p className="break-words font-medium">{user?.email ?? "Pending invite"}</p><p className="text-sm capitalize text-neutral-500">{memberRole}</p></div>{memberRole !== "owner" && <div className="flex flex-wrap gap-2">{isOwner && <form action={updateWorkspaceUserRole.bind(null, workspace.slug)} className="flex min-w-0 flex-1 gap-2 sm:flex-none"><input type="hidden" name="userId" value={user?.id} /><select name="role" defaultValue={memberRole} className="min-w-0 flex-1 rounded-lg border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm sm:w-auto"><option value="member">Member</option><option value="admin">Admin</option></select><button className="rounded-lg border border-neutral-700 px-3 py-1 text-sm">Save</button></form>}<form action={removeWorkspaceUser.bind(null, workspace.slug)} className="flex-1 sm:flex-none"><input type="hidden" name="userId" value={user?.id} /><button className="w-full rounded-lg border border-red-900 px-3 py-1 text-sm text-red-300 sm:w-auto">Remove</button></form></div>}</div>)}</div></section><p className="mt-10 text-center text-xs text-neutral-600">Betelgeze © 2026</p></div></main>
}
