import { WorkspaceBanner } from "@/components/admin/WorkspaceBanner"
import { LeadgenTabs } from "@/components/leadgen/LeadgenTabs"
import { WorkspaceTopBar } from "@/components/workspace/WorkspaceTopBar"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { requireWorkspace } from "@/lib/workspaces"
import { createLeadgenPoll } from "./actions"

export const dynamic = "force-dynamic"

type PageProps = { params: Promise<{ workspaceSlug: string }> }

export default async function LeadgenWorkspacePage({ params }: PageProps) {
    const { workspaceSlug } = await params
    const { workspace, user, role } = await requireWorkspace(workspaceSlug)
    const pollsResult = await supabaseAdmin
        .from("leadgen_polls")
        .select("id, status, trigger, source_count, candidate_count, normalised_count, deduped_count, enriched_count, qualified_count, created_at, started_at, completed_at, error")
        .eq("workspace_id", workspace.id)
        .order("created_at", { ascending: false })
        .limit(12)

    const polls = pollsResult.error ? [] : pollsResult.data ?? []
    const latestPoll = polls[0]

    return <main className="min-h-screen bg-neutral-950 px-4 py-5 text-white sm:px-6 sm:py-6">
        <div className="mx-auto max-w-7xl">
            <WorkspaceTopBar userId={user.id} workspace={workspace} currentProduct="leadgen" />
            <WorkspaceBanner bannerPath={workspace.leadgen_banner_path} logoPath={workspace.logo_path} name={workspace.name} height={workspace.leadgen_banner_height} position={workspace.leadgen_banner_position} />
            <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
                <div>
                    <h1 className="text-2xl font-semibold tracking-tight">{workspace.name}</h1>
                    <p className="mt-2 text-sm text-neutral-400">Poll sources, normalise records, dedupe companies, enrich signals, and route the best leads. Signed in as {role}.</p>
                </div>
                <div className="flex w-full items-center justify-start gap-2 sm:w-auto sm:justify-end">
                    <form action={createLeadgenPoll.bind(null, workspace.slug)}>
                        <button className="inline-flex min-h-11 items-center justify-center rounded-lg bg-white px-4 py-2 text-center text-sm font-medium leading-none text-black sm:min-h-10 sm:px-3">New Poll</button>
                    </form>
                </div>
            </div>

            <LeadgenTabs workspaceSlug={workspace.slug} active="polls" />

            <div className="mt-5 grid gap-3 sm:grid-cols-3">
                {[
                    ["Polls", polls.length],
                    ["Latest candidates", latestPoll?.candidate_count ?? 0],
                    ["Latest qualified", latestPoll?.qualified_count ?? 0],
                ].map(([label, value]) => <div key={label} className="rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2">
                    <p className="text-xs text-neutral-500">{label}</p>
                    <p className="mt-1 text-lg font-semibold">{value}</p>
                </div>)}
            </div>

            <section className="mt-5 rounded-2xl border border-neutral-800 bg-neutral-900">
                <div className="border-b border-neutral-800 px-5 py-4">
                    <h2 className="font-semibold">Polls</h2>
                    <p className="mt-1 text-sm text-neutral-500">Manual and scheduled source runs will appear here as the pipeline comes online.</p>
                </div>
                {polls.length ? <div className="overflow-x-auto">
                    <table className="w-full min-w-[720px] text-left text-sm">
                        <thead className="text-xs uppercase tracking-wide text-neutral-500">
                            <tr>
                                <th className="px-5 py-3 font-medium">Created</th>
                                <th className="px-5 py-3 font-medium">Trigger</th>
                                <th className="px-5 py-3 font-medium">Status</th>
                                <th className="px-5 py-3 font-medium">Candidates</th>
                                <th className="px-5 py-3 font-medium">Normalised</th>
                                <th className="px-5 py-3 font-medium">Deduped</th>
                                <th className="px-5 py-3 font-medium">Enriched</th>
                                <th className="px-5 py-3 font-medium">Qualified</th>
                            </tr>
                        </thead>
                        <tbody>
                            {polls.map((poll) => <tr key={poll.id} className="border-t border-neutral-800">
                                <td className="px-5 py-3 text-neutral-300">{new Date(poll.created_at).toLocaleString("en-IE", { dateStyle: "medium", timeStyle: "short" })}</td>
                                <td className="px-5 py-3 capitalize text-neutral-400">{poll.trigger}</td>
                                <td className="px-5 py-3"><span className="rounded-full bg-neutral-800 px-2 py-1 text-xs capitalize text-neutral-200">{poll.status}</span></td>
                                <td className="px-5 py-3 text-neutral-300">{poll.candidate_count}</td>
                                <td className="px-5 py-3 text-neutral-300">{poll.normalised_count}</td>
                                <td className="px-5 py-3 text-neutral-300">{poll.deduped_count}</td>
                                <td className="px-5 py-3 text-neutral-300">{poll.enriched_count}</td>
                                <td className="px-5 py-3 text-neutral-300">{poll.qualified_count}</td>
                            </tr>)}
                        </tbody>
                    </table>
                </div> : <div className="grid gap-4 p-5 lg:grid-cols-[1.1fr_0.9fr]">
                    <div className="rounded-xl border border-neutral-800 bg-neutral-950 p-5">
                        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-neutral-500">Pipeline shape</p>
                        <h3 className="mt-3 text-xl font-semibold">Sourcing → normalisation → dedupe → enrichment → validation → scoring → routing.</h3>
                        <p className="mt-3 max-w-2xl text-sm leading-6 text-neutral-400">The first working object is a poll. Press New Poll to queue a test run record. Source connectors and workers will be attached behind this surface next.</p>
                    </div>
                    <div className="rounded-xl border border-neutral-800 bg-neutral-950 p-5">
                        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-neutral-500">Source stack</p>
                        <ul className="mt-3 space-y-2 text-sm text-neutral-300">
                            <li>• GBP/Maps research surfaces.</li>
                            <li>• State licensing boards and Secretary of State registries.</li>
                            <li>• Aggregator directories such as Angi and Yelp.</li>
                            <li>• No data broker dependency for the first build.</li>
                        </ul>
                    </div>
                </div>}
            </section>
            <p className="mt-10 text-center text-xs text-neutral-600">Betelgeze © 2026</p>
        </div>
    </main>
}
