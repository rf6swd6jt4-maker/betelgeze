import Link from "next/link"
import { redirect } from "next/navigation"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { getCurrentUser } from "@/lib/workspaces"
import { LeaveWorkspaceForm } from "@/components/account/LeaveWorkspaceForm"
import { leaveWorkspace } from "./actions"
import { updateUsername } from "./actions"
import { ProfileSettings } from "@/components/account/ProfileSettings"

type PageProps = { params: Promise<{ username: string }> }

export default async function UserAccountPage({ params }: PageProps) {
    const { username } = await params
    const user = await getCurrentUser()
    if (!user) redirect("/login")
    const { data: profile } = await supabaseAdmin.from("user_profiles").select("username").eq("user_id", user.id).maybeSingle()
    if (!profile) redirect("/login")
    if (profile.username !== username) redirect(`/users/${profile.username}`)
    const { data: memberships } = await supabaseAdmin.from("workspace_memberships").select("workspace_id, role, workspaces!inner(name, slug, status)").eq("user_id", user.id)
    return <main className="min-h-screen bg-neutral-950 px-5 py-8 text-white sm:px-8"><div className="mx-auto max-w-3xl"><div className="flex items-start justify-between gap-4"><div><p className="text-sm text-neutral-400">Betelgeze account</p><h1 className="mt-2 text-3xl font-semibold">@{profile.username}</h1><p className="mt-2 text-sm text-neutral-400">{user.email}</p></div><Link href="/logout" className="rounded-lg border border-neutral-700 px-3 py-2 text-sm">Log out</Link></div><ProfileSettings username={profile.username} email={user.email ?? "your email address"} action={updateUsername} /><h2 className="mt-10 text-xl font-semibold">Your workspaces</h2><div className="mt-4 space-y-3">{(memberships ?? []).map((membership) => { const workspace = membership.workspaces as unknown as { name: string; slug: string; status: string }; if (workspace.status !== "active") return null; return <div key={membership.workspace_id} className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-neutral-800 bg-neutral-900 p-5"><div><Link href={`/dashboard/${workspace.slug}`} className="font-medium hover:underline">{workspace.name}</Link><p className="mt-1 text-sm capitalize text-neutral-500">{membership.role}</p></div><LeaveWorkspaceForm workspaceId={membership.workspace_id} action={leaveWorkspace.bind(null, profile.username)} /></div> })}</div><Link href="/sign-up" className="mt-7 inline-block text-sm text-neutral-300 underline">Create another dashboard</Link></div></main>
}
