import Link from "next/link"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { requireWorkspace } from "@/lib/workspaces"
import {
    inviteWorkspaceUser,
    removeWorkspaceUser,
    updateWorkspaceUserRole,
} from "./actions"

export const dynamic = "force-dynamic"
type PageProps = { params: Promise<{ workspaceSlug: string }> }

export default async function UsersPage({ params }: PageProps) {
    const { workspaceSlug } = await params
    const { workspace, role } = await requireWorkspace(workspaceSlug, "admin")
    const { data: memberships } = await supabaseAdmin
        .from("workspace_memberships")
        .select("user_id, role, created_at")
        .eq("workspace_id", workspace.id)
        .order("created_at")
    const users = await Promise.all(
        (memberships ?? []).map(async (membership) => ({
            ...membership,
            user: (await supabaseAdmin.auth.admin.getUserById(membership.user_id)).data.user,
        }))
    )
    const isOwner = role === "owner"

    return <main className="min-h-screen bg-neutral-950 px-4 py-6 text-white sm:px-6"><div className="mx-auto max-w-7xl"><p className="text-xs font-medium uppercase tracking-wide text-neutral-500">Betelgeze</p><h1 className="mt-2 text-2xl font-semibold">Users</h1><p className="mt-2 text-sm text-neutral-400">Manage access to {workspace.name}.</p><nav className="mt-5 flex flex-wrap gap-2 text-sm"><Link href={`/dashboard/${workspace.slug}`} className="rounded-lg border border-neutral-800 px-3 py-2 text-neutral-300">Clients</Link><Link href={`/dashboard/${workspace.slug}/invoices`} className="rounded-lg border border-neutral-800 px-3 py-2 text-neutral-300">Invoices</Link><Link href={`/dashboard/${workspace.slug}/health`} className="rounded-lg border border-neutral-800 px-3 py-2 text-neutral-300">System health</Link><Link href={`/dashboard/${workspace.slug}/users`} className="rounded-lg bg-white px-3 py-2 font-medium text-black">Users</Link></nav><form action={inviteWorkspaceUser.bind(null, workspace.slug)} className="mt-6 grid gap-3 rounded-2xl border border-neutral-800 bg-neutral-900 p-5 sm:grid-cols-[1fr_auto_auto]"><input name="email" type="email" required placeholder="person@business.com" className="rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2" /><select name="role" defaultValue="member" className="rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2"><option value="member">Member</option>{isOwner && <option value="admin">Admin</option>}</select><button className="rounded-lg bg-white px-4 py-2 font-medium text-black">Invite user</button></form><div className="mt-5 overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-900">{users.map(({ user, role: memberRole }) => <div key={user?.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-800 p-5 last:border-0"><div><p className="font-medium">{user?.email ?? "Pending invite"}</p><p className="text-sm capitalize text-neutral-500">{memberRole}</p></div>{memberRole !== "owner" && <div className="flex gap-2">{isOwner && <form action={updateWorkspaceUserRole.bind(null, workspace.slug)} className="flex gap-2"><input type="hidden" name="userId" value={user?.id} /><select name="role" defaultValue={memberRole} className="rounded-lg border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm"><option value="member">Member</option><option value="admin">Admin</option></select><button className="rounded-lg border border-neutral-700 px-3 py-1 text-sm">Save</button></form>}<form action={removeWorkspaceUser.bind(null, workspace.slug)}><input type="hidden" name="userId" value={user?.id} /><button className="rounded-lg border border-red-900 px-3 py-1 text-sm text-red-300">Remove</button></form></div>}</div>)}</div></div></main>
}
