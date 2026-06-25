import Link from "next/link"
import { WorkspaceBanner } from "@/components/admin/WorkspaceBanner"
import { WorkspaceTopBar } from "@/components/workspace/WorkspaceTopBar"
import { requireWorkspace } from "@/lib/workspaces"

export const dynamic = "force-dynamic"

type PageProps = { params: Promise<{ workspaceSlug: string }> }

export default async function LeadgenWorkspacePage({ params }: PageProps) {
    const { workspaceSlug } = await params
    const { workspace, user, role } = await requireWorkspace(workspaceSlug)

    return <main className="min-h-screen bg-neutral-950 px-4 py-5 text-white sm:px-6 sm:py-6">
        <div className="mx-auto max-w-7xl">
            <WorkspaceTopBar userId={user.id} workspace={workspace} currentProduct="leadgen" />
            <WorkspaceBanner bannerPath={workspace.leadgen_banner_path} logoPath={workspace.logo_path} name={workspace.name} height={workspace.leadgen_banner_height} position={workspace.leadgen_banner_position} />
            <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
                <div>
                    <h1 className="text-2xl font-semibold tracking-tight">{workspace.name}</h1>
                    <p className="mt-2 text-sm text-neutral-400">Build, review, and qualify leads for this workspace. Signed in as {role}.</p>
                </div>
            </div>

            <div className="mt-5 -mx-1 flex gap-2 overflow-x-auto px-1 pb-1 text-sm sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
                <Link href={`https://leadgen.betelgeze.com/${workspace.slug}`} className="shrink-0 rounded-lg bg-white px-3 py-2.5 font-medium text-black sm:py-2">Leads</Link>
                <span className="shrink-0 rounded-lg border border-neutral-800 px-3 py-2.5 text-neutral-500 sm:py-2">ICP</span>
                <span className="shrink-0 rounded-lg border border-neutral-800 px-3 py-2.5 text-neutral-500 sm:py-2">Sources</span>
                <Link href={`https://leadgen.betelgeze.com/${workspace.slug}/settings`} className="shrink-0 rounded-lg border border-neutral-800 px-3 py-2.5 text-neutral-300 sm:py-2">Settings</Link>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-3">
                {[
                    ["New leads", 0],
                    ["In review", 0],
                    ["Ready to call", 0],
                ].map(([label, value]) => <div key={label} className="rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2">
                    <p className="text-xs text-neutral-500">{label}</p>
                    <p className="mt-1 text-lg font-semibold">{value}</p>
                </div>)}
            </div>

            <section className="mt-5 rounded-2xl border border-neutral-800 bg-neutral-900">
                <div className="border-b border-neutral-800 px-5 py-4">
                    <h2 className="font-semibold">Lead intelligence is being rebuilt</h2>
                    <p className="mt-1 text-sm text-neutral-500">This is the new workspace-based home for leadgen.betelgeze.com/{workspace.slug}.</p>
                </div>
                <div className="grid gap-4 p-5 lg:grid-cols-[1.1fr_0.9fr]">
                    <div className="rounded-xl border border-neutral-800 bg-neutral-950 p-5">
                        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-neutral-500">Starting clean</p>
                        <h3 className="mt-3 text-xl font-semibold">No legacy lead data or automation is exposed here.</h3>
                        <p className="mt-3 max-w-2xl text-sm leading-6 text-neutral-400">The next build starts with evidence-backed lead research, quality controls, manual review, and clear dispositions before any CRM or dialler automation.</p>
                    </div>
                    <div className="rounded-xl border border-neutral-800 bg-neutral-950 p-5">
                        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-neutral-500">Planned first slice</p>
                        <ul className="mt-3 space-y-2 text-sm text-neutral-300">
                            <li>• Define the workspace ICP.</li>
                            <li>• Add research/source queues.</li>
                            <li>• Review leads with evidence and scoring.</li>
                            <li>• Move leads through manual call dispositions.</li>
                        </ul>
                    </div>
                </div>
            </section>
            <p className="mt-10 text-center text-xs text-neutral-600">Betelgeze © 2026</p>
        </div>
    </main>
}
