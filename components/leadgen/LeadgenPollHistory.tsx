import Link from "next/link"
import { LeadgenTabs } from "./LeadgenTabs"
import { LeadgenQuarantineNotice } from "./LeadgenQuarantineNotice"
import { List, ListItem, ListPrimaryRow, ListSecondaryRow, ListTitle } from "@/components/list/List"
import { PanelTabHeader } from "@/components/panel/PanelTabHeader"
import { Status, type StatusTone } from "@/components/ui"
import { WorkspaceTopBar } from "@/components/workspace/WorkspaceTopBar"
import { formatRelativeTime, shortId } from "@/lib/ui/relative-time"

type Poll = { id: string; status: string; trigger: string; candidate_count: number; qualified_count: number; created_at: string; error: string | null }

export function LeadgenPollHistory({ workspace, userId, polls, olderHref, hasCursor }: {
    workspace: { id: string; slug: string; name: string }
    userId: string
    polls: Poll[]
    olderHref: string | null
    hasCursor: boolean
}) {
    return <main className="min-h-screen bg-neutral-950 px-4 pb-5 text-white sm:px-6 sm:pb-6">
        <div className="mx-auto max-w-7xl">
            <WorkspaceTopBar userId={userId} workspace={workspace} currentProduct="leadgen" />
            <PanelTabHeader title="Poll history" description="Saved poll results. Open a poll to inspect its retained evidence and diagnostics." tabs={<LeadgenTabs workspaceSlug={workspace.slug} active="polls" />} />
            <LeadgenQuarantineNotice />
            <List ariaLabel="Lead generation poll history">
                {polls.map((poll) => {
                    const tone: StatusTone = poll.status === "completed" ? "green" : poll.status === "failed" ? "red" : "grey"
                    return <ListItem key={poll.id}>
                        <ListPrimaryRow>
                            <ListTitle href={`/${workspace.slug}/leadgen/poll/${poll.id}`}>Poll {shortId(poll.id)}</ListTitle>
                            <Status tone={tone} label={poll.status === "queued" || poll.status === "running" ? `${poll.status} · paused` : poll.status} />
                        </ListPrimaryRow>
                        <ListSecondaryRow>{poll.candidate_count} candidates · {poll.qualified_count} qualified · {formatRelativeTime(poll.created_at)}</ListSecondaryRow>
                        {poll.error ? <p className="mt-2 whitespace-pre-wrap break-words text-xs text-neutral-400">{poll.error}</p> : null}
                    </ListItem>
                })}
                {!polls.length ? <p className="p-5 text-sm text-neutral-400">No saved polls on this page.</p> : null}
            </List>
            <nav aria-label="Poll history pages" className="mt-5 flex justify-between gap-4 text-sm text-neutral-300">
                {hasCursor ? <Link href={`/${workspace.slug}/leadgen/polls`} prefetch={false}>Newest polls</Link> : <span />}
                {olderHref ? <Link href={olderHref} prefetch={false}>Older polls</Link> : null}
            </nav>
        </div>
    </main>
}
