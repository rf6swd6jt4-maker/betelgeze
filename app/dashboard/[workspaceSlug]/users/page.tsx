import Link from "next/link"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { requireWorkspace } from "@/lib/workspaces"
import { inviteWorkspaceUser, removeWorkspaceUser, updateWorkspaceUserRole } from "./actions"

export const dynamic = "force-dynamic"
type PageProps = { params: Promise<{ workspaceSlug: string }> }

export default async function UsersPage({ params }: PageProps) {
    const { workspaceSlug } = await params
    const { workspace } = await requireWorkspace(workspaceSlug, "owner")
    const { data: memberships } = await supabaseAdmin.from("workspace_memberships").select("user_id, role, created_at").eq("workspace_id", workspace.id).order("created_at")
    const users = await Promise.all((memberships ?? []).map(async (membership) => ({ ...membership, user: (await supabaseAdmin.auth.admin.getUserById(membership.user_id)).data.user })))
    return <main className="min-h-screen bg-neutral-950 px-5 py-7 text-white sm:px-8"><div className="mx-auto max-w-3xl"><Link href={`/dashboard/${workspace.slug}`} className="text-sm text-neutral-400 hover:text-white">← Dashboard</Link><h1 className="mt-4 text-3xl font-semibold">Users</h1><p className="mt-2 text-neutral-400">Manage access to {workspace.name}.</p><form action={inviteWorkspaceUser.bind(null, workspace.slug)} className="mt-8 grid gap-3 rounded-2xl border border-neutral-800 bg-neutral-900 p-5 sm:grid-cols-[1fr_auto_auto]"><input name="email" type="email" required placeholder="person@business.com" className="rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2" /><select name="role" defaultValue="member" className="rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2"><option value="member">Member</option><option value="admin">Admin</option><option value="owner">Owner</option></select><button className="rounded-lg bg-white px-4 py-2 font-medium text-black">Invite</button></form><div className="mt-5 overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-900">{users.map(({ user, role }) => <div key={user?.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-800 p-5 last:border-0"><div><p className="font-medium">{user?.email ?? "Pending invite"}</p><p className="text-sm text-neutral-500">{role}</p></div><div className="flex gap-2"><form action={updateWorkspaceUserRole.bind(null, workspace.slug)}><input type="hidden" name="userId" value={user?.id} /><select name="role" defaultValue={role} onChange={(event) => event.currentTarget.form?.requestSubmit()} className="rounded-lg border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm"><option value="member">Member</option><option value="admin">Admin</option><option value="owner">Owner</option></select></form><form action={removeWorkspaceUser.bind(null, workspace.slug)}><input type="hidden" name="userId" value={user?.id} /><button className="rounded-lg border border-red-900 px-3 py-1 text-sm text-red-300">Remove</button></form></div></div>)}</div></div></main>
}
