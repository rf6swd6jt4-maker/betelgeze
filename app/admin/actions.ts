"use server"

import { redirect } from "next/navigation"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { requireAdmin } from "@/lib/admin/auth"

export async function removeClientFromList(clientId: string) {
    const { workspace } = await requireAdmin()
    await supabaseAdmin
        .from("clients")
        .update({ archived_at: new Date().toISOString() })
        .eq("id", clientId)
        .eq("workspace_id", workspace.id)
    redirect("/admin")
}
