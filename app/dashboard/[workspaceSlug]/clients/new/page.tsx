import Link from "next/link"
import { requireWorkspace } from "@/lib/workspaces"
import { createWorkspaceClient } from "./actions"

type PageProps = { params: Promise<{ workspaceSlug: string }> }
export default async function NewWorkspaceClientPage({ params }: PageProps) {
    const { workspaceSlug } = await params
    const { workspace } = await requireWorkspace(workspaceSlug, "admin")
    return <main className="flex min-h-screen items-center justify-center bg-neutral-950 px-6 text-white"><form action={createWorkspaceClient.bind(null, workspace.slug)} className="w-full max-w-lg rounded-2xl border border-neutral-800 bg-neutral-900 p-7"><Link className="text-sm text-neutral-400" href={`/dashboard/${workspace.slug}`}>← Dashboard</Link><h1 className="mt-4 text-2xl font-semibold">Add client</h1><p className="mt-2 text-sm text-neutral-400">This creates a secure onboarding link. External automations are unavailable until this workspace connects them.</p><label className="mt-6 block text-sm">Client name<input required name="name" className="mt-2 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-3" /></label><label className="mt-4 block text-sm">Client email<input type="email" name="email" className="mt-2 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-3" /></label><button className="mt-6 rounded-lg bg-white px-4 py-3 font-medium text-black">Create onboarding link</button></form></main>
}
