"use server"

import { redirect } from "next/navigation"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { requireAdmin } from "@/lib/admin/auth"
import { normalizeMessageAddress } from "@/lib/client-messages/addresses"
import { SERVICES } from "@/lib/onboarding/services"
import {
    getProjectTimeframeDays,
    ProjectTimeframeUnit,
} from "@/lib/onboarding/project-timeframe"
import { createAndSendStripeInvoice } from "@/lib/stripe/api"
import { sendSaleConsentTemplate } from "@/lib/client-sales/automation"

const DEFAULT_CURRENCY = "eur"

function getInvoiceDaysUntilDue() {
    const value = Number(process.env.STRIPE_INVOICE_DAYS_UNTIL_DUE ?? "7")

    return Number.isFinite(value) && value > 0 ? Math.round(value) : 7
}

function parseCurrencyAmountToMinorUnits(value: string) {
    const normalized = value.trim().replace(/,/g, "")

    if (!normalized) return 0

    const match = normalized.match(/^(\d+)(?:\.(\d{1,2}))?$/u)

    if (!match) return 0

    const major = Number(match[1])
    const minor = Number((match[2] ?? "").padEnd(2, "0"))

    if (!Number.isFinite(major) || !Number.isFinite(minor)) return 0

    return major * 100 + minor
}

function getSaleErrorCode(error: unknown) {
    const message = error instanceof Error ? error.message.toLowerCase() : ""

    if (message.includes("stripe")) return "stripe-failed"
    if (message.includes("client_sales")) return "schema-missing"

    return "create-failed"
}

export async function createSaleInvoice(formData: FormData) {
    await requireAdmin()

    const name = String(formData.get("name") ?? "").trim()
    const email = String(formData.get("email") ?? "").trim().toLowerCase()
    const phone = normalizeMessageAddress(String(formData.get("phone") ?? ""))
    const currency = String(formData.get("currency") ?? DEFAULT_CURRENCY)
        .trim()
        .toLowerCase()
    const timeframeAmount = Number(formData.get("project_timeframe_amount"))
    const timeframeUnit = String(
        formData.get("project_timeframe_unit") ?? "days"
    ) as ProjectTimeframeUnit
    const projectTimeframeDays = getProjectTimeframeDays(
        timeframeAmount,
        timeframeUnit
    )
    const selectedServices = formData
        .getAll("services")
        .map(String)
        .filter((serviceKey) => serviceKey in SERVICES)
    const isTestAutomation = formData.get("is_test_automation") === "on"
    const lineItems = selectedServices
        .map((serviceKey) => {
            const service = SERVICES[serviceKey]
            const amount = parseCurrencyAmountToMinorUnits(
                String(formData.get(`amount_${serviceKey}`) ?? "")
            )

            return {
                serviceKey,
                description: service.title,
                amount,
            }
        })
        .filter((lineItem) => isTestAutomation || lineItem.amount > 0)
    const billableServiceKeys = lineItems.map((lineItem) => lineItem.serviceKey)

    if (!name || !email || !phone || billableServiceKeys.length === 0) {
        redirect("/admin/sales/new?error=missing-fields")
    }

    const totalAmount = lineItems.reduce(
        (total, lineItem) => total + lineItem.amount,
        0
    )
    const { data: sale, error: saleError } = await supabaseAdmin
        .from("client_sales")
        .insert({
            client_name: name,
            client_email: email,
            client_phone: phone,
            service_keys: billableServiceKeys,
            line_items: lineItems,
            project_timeframe_days: projectTimeframeDays,
            currency,
            total_amount: totalAmount,
            status: isTestAutomation ? "test_paid" : "invoice_creating",
            raw_payload: isTestAutomation
                ? {
                      test_automation: true,
                      note: "Stripe invoice creation skipped by admin.",
                  }
                : {},
        })
        .select("id")
        .single()

    if (saleError || !sale) {
        redirect("/admin/sales/new?error=schema-missing")
    }

    if (isTestAutomation) {
        await sendSaleConsentTemplate(sale.id)
        redirect(`/admin?testSale=${sale.id}`)
    }

    let invoiceId: string

    try {
        const invoice = await createAndSendStripeInvoice({
            saleId: sale.id,
            name,
            email,
            phone,
            currency,
            lineItems,
            serviceKeys: billableServiceKeys,
            projectTimeframeDays,
            daysUntilDue: getInvoiceDaysUntilDue(),
        })

        await supabaseAdmin
            .from("client_sales")
            .update({
                status: "invoice_sent",
                stripe_customer_id: invoice.customerId,
                stripe_invoice_id: invoice.invoiceId,
                stripe_invoice_status: invoice.invoiceStatus,
                stripe_hosted_invoice_url: invoice.hostedInvoiceUrl,
                stripe_invoice_pdf: invoice.invoicePdf,
                raw_payload: invoice.rawInvoice,
                updated_at: new Date().toISOString(),
            })
            .eq("id", sale.id)
        invoiceId = invoice.invoiceId
    } catch (error) {
        await supabaseAdmin
            .from("client_sales")
            .update({
                status: "invoice_failed",
                raw_payload: {
                    error: error instanceof Error ? error.message : String(error),
                },
                updated_at: new Date().toISOString(),
            })
            .eq("id", sale.id)

        redirect(`/admin/sales/new?error=${getSaleErrorCode(error)}`)
    }

    redirect(`/admin?invoice=${invoiceId}`)
}
