"use server"

import { redirect } from "next/navigation"
import { requireAdmin } from "@/lib/admin/auth"
import { supabaseAdmin } from "@/lib/supabase/admin"

export async function removeInvoice(saleId: string) {
    const { workspace, user } = await requireAdmin()
    const { error } = await supabaseAdmin
        .from("client_sales")
        .update({ deleted_at: new Date().toISOString(), deleted_by: user.id })
        .eq("id", saleId)
        .eq("workspace_id", workspace.id)

    if (error) throw new Error("Could not remove this invoice.")
    redirect("/admin/invoices")
}
