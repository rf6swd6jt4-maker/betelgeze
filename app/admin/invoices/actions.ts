"use server"

import { redirect } from "next/navigation"
import { requireAdmin } from "@/lib/admin/auth"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { sendSaleConsentTemplate } from "@/lib/client-sales/automation"

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

export async function retryInvoiceAutomation(saleId: string) {
    const { workspace } = await requireAdmin()
    const { data: sale } = await supabaseAdmin
        .from("client_sales")
        .select("id, status")
        .eq("id", saleId)
        .eq("workspace_id", workspace.id)
        .maybeSingle()

    if (!sale) throw new Error("Invoice not found.")

    if (["paid", "test_paid", "paid_consent_template_failed", "manual_consent_template_failed"].includes(sale.status)) {
        const result = await sendSaleConsentTemplate(sale.id)
        if (!result.ok) throw new Error(result.error ?? "Could not retry invoice automation.")
    } else {
        await supabaseAdmin
            .from("client_sales")
            .update({
                raw_payload: {
                    retry_unsupported: `Retry is not available for status ${sale.status}.`,
                },
                updated_at: new Date().toISOString(),
            })
            .eq("id", sale.id)
    }

    redirect("/admin/invoices")
}
