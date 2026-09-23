import { LEADGEN_HISTORY_PAGE_SIZE, leadgenHistoryCursor } from "@/lib/leadgen/history"
import { LeadgenPollHistory } from "@/components/leadgen/LeadgenPollHistory"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { requireWorkspace } from "@/lib/workspaces"

export const dynamic = "force-dynamic"

type PageProps = { params: Promise<{ workspaceSlug: string }>; searchParams: Promise<{ before?: string; beforeId?: string }> }

export default async function LeadgenPollsPage({ params, searchParams }: PageProps) {
    const { workspaceSlug } = await params
    const { workspace, user } = await requireWorkspace(workspaceSlug, "admin")
    const { before, beforeId } = await searchParams
    const cursor = leadgenHistoryCursor(before, beforeId)
    let query = supabaseAdmin.from("leadgen_polls")
        .select("id, status, trigger, candidate_count, qualified_count, created_at, error")
        .eq("workspace_id", workspace.id)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(LEADGEN_HISTORY_PAGE_SIZE + 1)
    if (cursor) query = query.or(`created_at.lt.${cursor.before},and(created_at.eq.${cursor.before},id.lt.${cursor.beforeId})`)
    const result = await query
    if (result.error) throw new Error("Could not load poll history. Please retry.")
    const rows = result.data ?? []
    const polls = rows.slice(0, LEADGEN_HISTORY_PAGE_SIZE)
    const last = polls.at(-1)
    const olderHref = rows.length > LEADGEN_HISTORY_PAGE_SIZE && last
        ? `/${workspace.slug}/leadgen/polls?${new URLSearchParams({ before: last.created_at, beforeId: last.id })}` : null
    return <LeadgenPollHistory workspace={workspace} userId={user.id} polls={polls} olderHref={olderHref} hasCursor={Boolean(cursor)} />
}
