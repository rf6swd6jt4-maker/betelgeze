import { List, ListItem, ListPrimaryRow, ListSecondaryRow, ListTitle, ListTrailing } from "@/components/list/List"
import { PanelTabHeader } from "@/components/panel/PanelTabHeader"
import { QuickStats } from "@/components/panel/QuickStats"
import { Status } from "@/components/ui"
import { QueuePanelTabs } from "@/components/work-queue/QueuePanelTabs"
import { WorkspaceTopBar } from "@/components/workspace/WorkspaceTopBar"
import { ATTENTION_LABELS, attentionHref, parseAttention } from "@/lib/needs-attention"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { formatRelativeTime } from "@/lib/ui/relative-time"
import { requireWorkspace } from "@/lib/workspaces"

export const dynamic = "force-dynamic"

export default async function NeedsAttentionPage({ params }: { params: Promise<{ workspaceSlug: string }> }) {
    const { workspaceSlug } = await params
    const { workspace, user } = await requireWorkspace(workspaceSlug, "admin")
    const { data, error } = await supabaseAdmin.rpc("workspace_needs_attention", { p_workspace: workspace.id, p_actor: user.id })
    const unavailable = error?.code === "PGRST202" || error?.code === "42883"
    if (error && !unavailable) throw new Error(error.code === "P0001" ? error.message : "Could not load what needs attention.")
    const groups = unavailable ? null : parseAttention(data)
    if (!unavailable && !groups) throw new Error("What needs attention could not be read.")
    const total = groups?.reduce((sum, group) => sum + group.total, 0) ?? 0
    const count = (kind: string) => groups?.find(group => group.kind === kind)?.total ?? 0

    return <main className="min-h-screen bg-neutral-950 px-4 pb-7 text-white sm:px-6">
        <WorkspaceTopBar userId={user.id} workspace={workspace} currentProduct="client-work" />
        <div className="mx-auto max-w-7xl">
            <PanelTabHeader title="Needs attention"
                description={`Team-wide items nobody may be acting on, oldest first. Up to five of each kind.${total ? ` ${total} open now.` : ""}`}
                tabs={<QueuePanelTabs workspaceSlug={workspace.slug} active="attention" />} />
            {groups === null ? <p role="status" className="mt-5 text-sm text-neutral-400">Needs attention needs a database update that has not been applied yet.</p> : <>
                <QuickStats ariaLabel="Needs attention statistics" items={[
                    { label: "Open items", value: total },
                    { label: "Waiting on a reply", value: count("waiting_on_reply") },
                    { label: "Overdue", value: count("overdue_task") },
                ]} />
                {groups.length === 0 ? <p className="mt-5 text-sm text-neutral-400">Nothing needs attention right now.</p>
                    : <List ariaLabel="Needs attention">{groups.flatMap(group => group.items.map(item => {
                        const href = attentionHref(workspace.slug, group.kind, item)
                        const meta = ATTENTION_LABELS[group.kind]
                        return <ListItem key={`${group.kind}:${item.recordId}`}>
                            <ListPrimaryRow>
                                <ListTitle href={href} className="flex-1">{group.kind === "waiting_on_reply" || group.kind === "stalled_onboarding" ? item.client ?? item.title : item.title}</ListTitle>
                                <Status label={meta.label} tone={meta.tone} />
                            </ListPrimaryRow>
                            <ListSecondaryRow>
                                <span className="min-w-0 flex-1 truncate text-neutral-400">{group.kind === "waiting_on_reply" || group.kind === "stalled_onboarding" ? item.title : item.client ?? "No client"}{group.total > group.items.length ? ` · ${group.total} in total` : ""}</span>
                                <ListTrailing>{item.since ? <span className="text-neutral-500">{formatRelativeTime(item.since)}</span> : null}</ListTrailing>
                            </ListSecondaryRow>
                        </ListItem>
                    }))}</List>}
            </>}
        </div>
    </main>
}
