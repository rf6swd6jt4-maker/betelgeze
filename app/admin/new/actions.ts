"use server"

import { redirect } from "next/navigation"
import { requireAdmin } from "@/lib/admin/auth"
import { normalizeMessageAddress } from "@/lib/client-messages/addresses"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { sendSaleConsentTemplate } from "@/lib/client-sales/automation"

export async function createClient(formData: FormData) {
    await requireAdmin()

    const name = String(formData.get("name") ?? "").trim()
    const email = String(formData.get("email") ?? "").trim().toLowerCase()
    const phone = normalizeMessageAddress(String(formData.get("phone") ?? ""))
    if (!name || !phone) {
        redirect("/admin/new?error=missing-fields")
    }

    const { data: sale, error: saleError } = await supabaseAdmin
        .from("client_sales")
        .insert({
            client_name: name,
            client_email: email || null,
            client_phone: phone,
            service_keys: [],
            line_items: [],
            currency: "usd",
            total_amount: 0,
            status: "manual_consent_pending",
            raw_payload: { flow: "manual_migration" },
        })
        .select("id")
        .single()

    if (saleError || !sale) {
        redirect("/admin/new?error=schema-missing")
    }

    const consent = await sendSaleConsentTemplate(sale.id)

    if (!consent.ok) {
        redirect("/admin/new?error=consent-template-failed")
    }

    redirect("/admin/new?created=consent-sent")
}
