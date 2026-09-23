import Link from "next/link"
import { notFound } from "next/navigation"
import { DetailField, DetailFields, DetailPageHeader } from "@/components/detail"
import { SquarePill, Status } from "@/components/ui"
import { WorkspaceTopBar } from "@/components/workspace/WorkspaceTopBar"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { formatRelativeTime, shortId } from "@/lib/ui/relative-time"
import { requireWorkspace } from "@/lib/workspaces"

export const dynamic = "force-dynamic"

export default async function LeadgenPollArchive({ params }: { params: Promise<{ workspaceSlug: string; pollId: string }> }) {
    const { workspaceSlug, pollId } = await params
    const { workspace, user } = await requireWorkspace(workspaceSlug, "admin")
    const result = await supabaseAdmin.from("leadgen_polls")
        .select("id, status, trigger, source_count, source_snapshot, icp_snapshot, candidate_count, normalised_count, deduped_count, enriched_count, qualified_count, current_stage, stage_summary, created_at, started_at, completed_at, error")
        .eq("workspace_id", workspace.id).eq("id", pollId).maybeSingle()
    if (result.error) throw new Error("Could not load this saved record. Please retry.")
    if (!result.data) notFound()
    const poll = result.data
    const tone = poll.status === "completed" ? "green" : poll.status === "failed" ? "red" : "grey"
    return <main className="min-h-screen bg-neutral-950 px-4 pb-5 text-white sm:px-6 sm:pb-6">
        <div className="mx-auto max-w-6xl">
            <WorkspaceTopBar userId={user.id} workspace={workspace} currentProduct="leadgen" />
            <div className="pt-5">
                <Link className="mb-5 inline-block text-sm text-blue-300 underline" href={`/${workspace.slug}/leadgen/polls`}>Poll history</Link>
                <DetailPageHeader category="Poll" reference={shortId(poll.id)} title="Saved poll" labels={<SquarePill>{poll.trigger === "manual" ? "Manual" : "Automated"}</SquarePill>} updated={formatRelativeTime(poll.completed_at ?? poll.started_at ?? poll.created_at)} />
                <DetailFields>
                    <DetailField label="Status" icon="status"><Status label={poll.status === "queued" || poll.status === "running" ? `${poll.status} · retired` : poll.status} tone={tone} /></DetailField>
                    <DetailField label="Created" icon="time" className="lg:border-l lg:border-neutral-900 lg:pl-8">{new Date(poll.created_at).toLocaleString("en-IE")}</DetailField>
                    <DetailField label="Candidates" icon="source">{poll.candidate_count ?? 0}</DetailField>
                    <DetailField label="Qualified" icon="source" className="lg:border-l lg:border-neutral-900 lg:pl-8">{poll.qualified_count ?? 0}</DetailField>
                    <DetailField label="Last stage" icon="status">{poll.current_stage ?? "—"}</DetailField>
                    <DetailField label="Sources" icon="source" className="lg:border-l lg:border-neutral-900 lg:pl-8">{poll.source_count ?? 0}</DetailField>
                </DetailFields>
                {poll.error ? <section className="mt-6"><h2 className="text-lg font-semibold">Recorded error</h2><p className="mt-2 whitespace-pre-wrap break-words text-sm text-neutral-300">{poll.error}</p></section> : null}
                <section className="mt-6"><h2 className="text-lg font-semibold">Saved diagnostics</h2><p className="mt-1 text-sm text-neutral-400">Historical snapshots remain unchanged. This archive does not run or resume processing.</p>
                    <pre className="mt-3 max-h-96 overflow-auto rounded-lg border border-neutral-800 p-4 text-xs text-neutral-300">{JSON.stringify({ source_snapshot: poll.source_snapshot, icp_snapshot: poll.icp_snapshot, stage_summary: poll.stage_summary }, null, 2)}</pre>
                </section>
            </div>
        </div>
    </main>
}
