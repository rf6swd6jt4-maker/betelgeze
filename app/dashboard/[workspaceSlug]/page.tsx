import Link from "next/link"
import { WorkspaceTopBar } from "@/components/workspace/WorkspaceTopBar"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { requireWorkspace } from "@/lib/workspaces"

export const dynamic = "force-dynamic"

type PageProps = { params: Promise<{ workspaceSlug: string }> }

export default async function WorkspaceDashboard({ params }: PageProps) {
    const { workspaceSlug } = await params
    const { workspace, role, user } = await requireWorkspace(workspaceSlug)
    const { data: clients } = await supabaseAdmin
        .from("clients")
        .select("id, name, email, created_at, archived_at")
        .eq("workspace_id", workspace.id)
        .is("archived_at", null)
        .order("created_at", { ascending: false })

    return <main className="min-h-screen bg-neutral-950 px-5 pb-7 text-white sm:px-8"><WorkspaceTopBar userId={user.id} workspace={workspace} currentProduct="client-work" /><div className="mx-auto max-w-6xl"><header className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-sm text-neutral-400">Betelgeze / {workspace.name}</p><h1 className="mt-2 text-3xl font-semibold">Dashboard</h1><p className="mt-2 text-sm text-neutral-400">Signed in as {role}.</p></div><nav className="flex flex-wrap gap-2 text-sm"><Link className="rounded-lg border border-neutral-700 px-3 py-2" href={`/dashboard/${workspace.slug}/users`}>Users</Link>{role !== "member" && <Link className="rounded-lg bg-white px-3 py-2 font-medium text-black" href={`/dashboard/${workspace.slug}/clients/new`}>Add client</Link>}</nav></header><section className="mt-8 rounded-2xl border border-neutral-800 bg-neutral-900"><div className="border-b border-neutral-800 px-5 py-4"><h2 className="font-semibold">Clients</h2></div>{clients?.length ? <ul>{clients.map((client) => <li key={client.id} className="flex items-center justify-between border-b border-neutral-800 px-5 py-4 last:border-0"><div><p className="font-medium">{client.name || "Unnamed client"}</p><p className="text-sm text-neutral-400">{client.email || "No email"}</p></div></li>)}</ul> : <p className="px-5 py-10 text-sm text-neutral-400">No clients yet. Add your first client to create an onboarding link.</p>}</section></div></main>
}
