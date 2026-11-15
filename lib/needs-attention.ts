// Shapes and wording for the Needs attention tab. The read itself is workspace_needs_attention (owners and admins only).

export type AttentionKind = "unassigned_service" | "waiting_on_reply" | "stalled_onboarding" | "disputed_task" | "overdue_task" | "removed_member_work"

export type AttentionItem = { since: string | null; relationshipId: string | null; client: string | null; title: string; recordId: string }
export type AttentionGroup = { kind: AttentionKind; total: number; items: AttentionItem[] }

const ORDER: AttentionKind[] = ["unassigned_service", "removed_member_work", "waiting_on_reply", "disputed_task", "overdue_task", "stalled_onboarding"]

export const ATTENTION_LABELS: Record<AttentionKind, { label: string; tone: "red" | "yellow" }> = {
    unassigned_service: { label: "No assignee", tone: "red" },
    removed_member_work: { label: "Left on a removed person", tone: "red" },
    waiting_on_reply: { label: "Waiting on a reply", tone: "yellow" },
    disputed_task: { label: "Disputed", tone: "yellow" },
    overdue_task: { label: "Overdue", tone: "yellow" },
    stalled_onboarding: { label: "Onboarding stalled", tone: "yellow" },
}

export function parseAttention(raw: unknown): AttentionGroup[] | null {
    if (!Array.isArray(raw)) return null
    const groups: AttentionGroup[] = []
    for (const entry of raw as Array<Record<string, unknown>>) {
        if (!entry || !ORDER.includes(entry.kind as AttentionKind) || !Array.isArray(entry.items)) return null
        groups.push({
            kind: entry.kind as AttentionKind, total: Number(entry.total ?? 0),
            items: (entry.items as Array<Record<string, unknown>>).map(item => ({
                since: typeof item.since === "string" ? item.since : null,
                relationshipId: typeof item.relationshipId === "string" ? item.relationshipId : null,
                client: typeof item.client === "string" ? item.client : null,
                title: typeof item.title === "string" ? item.title : "Untitled",
                recordId: String(item.recordId ?? ""),
            })),
        })
    }
    return groups.sort((left, right) => ORDER.indexOf(left.kind) - ORDER.indexOf(right.kind))
}

/** Where each row opens: the client for client-level items, the task for task-level items. */
export function attentionHref(workspaceSlug: string, kind: AttentionKind, item: AttentionItem) {
    if (kind === "disputed_task" || kind === "overdue_task" || kind === "removed_member_work") return `/${workspaceSlug}/work-items/${item.recordId}`
    return item.relationshipId ? `/${workspaceSlug}/relationships/${item.relationshipId}` : null
}
