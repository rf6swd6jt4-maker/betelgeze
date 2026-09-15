import "server-only"
import { requireWorkspace } from "@/lib/workspaces"
import { supabaseAdmin } from "@/lib/supabase/admin"
import type { QueueItem } from "./ranking"
import { queueAiConfiguration } from "./worker"
export async function loadPersonalQueue(slug: string, offset = 0, view: "ready" | "deferred" = "ready") {
    const { workspace, user } = await requireWorkspace(slug)
    const result = await supabaseAdmin.rpc("read_personal_work_queue", { p_workspace: workspace.id, p_user: user.id, p_offset: offset, p_view: view })
    if (result.error) throw new Error("Could not load your work queue")
    const data = result.data as { items: QueueItem[]; hasMore: boolean; total: number; ready: number; deferred: number; assessed: number }
    return { ...data, view, items: data.items.slice(0,30), kind: "queue" as const, userId: user.id, workspaceId: workspace.id, workspaceSlug: workspace.slug, context: null, aiEnabled: queueAiConfiguration().enabled }
}
export type PersonalQueueSnapshot = Awaited<ReturnType<typeof loadPersonalQueue>>
