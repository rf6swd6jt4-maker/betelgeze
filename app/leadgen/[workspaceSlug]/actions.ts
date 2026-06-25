"use server"

import { revalidatePath } from "next/cache"
import { requireWorkspace } from "@/lib/workspaces"
import { supabaseAdmin } from "@/lib/supabase/admin"

export async function createLeadgenPoll(slug: string) {
    const { workspace, user } = await requireWorkspace(slug, "admin")
    const { error } = await supabaseAdmin.from("leadgen_polls").insert({
        workspace_id: workspace.id,
        requested_by: user.id,
        trigger: "manual",
        status: "queued",
    })
    if (error) throw new Error("Could not queue a new leadgen poll.")
    revalidatePath(`/leadgen/${slug}`)
    revalidatePath(`/leadgen/${slug}/polls`)
}

export async function cancelLeadgenPoll(slug: string, pollId: string) {
    const { workspace } = await requireWorkspace(slug, "admin")
    const { error } = await supabaseAdmin
        .from("leadgen_polls")
        .update({ status: "cancelled", completed_at: new Date().toISOString() })
        .eq("id", pollId)
        .eq("workspace_id", workspace.id)
        .in("status", ["queued", "running"])
    if (error) throw new Error("Could not cancel this poll.")
    revalidatePath(`/leadgen/${slug}`)
    revalidatePath(`/leadgen/${slug}/polls`)
}
