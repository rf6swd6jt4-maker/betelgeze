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
import { getWorkspaceProviderConfig } from "@/lib/workspace-integrations"
import { workspaceHref } from "@/lib/relationships"

const DEFAULT_CURRENCY = "usd"

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

function newInvoiceHref(
    workspaceSlug: string,
    error: string,
    relationshipId?: string | null
) {
    const params = new URLSearchParams({ error })
    if (relationshipId) params.set("relationshipId", relationshipId)
    return workspaceHref(workspaceSlug, `sales/new?${params.toString()}`)
}

export async function createSaleInvoice(formData: FormData) {
    const { workspace, user } = await requireAdmin()
    const stripeConfig = await getWorkspaceProviderConfig(workspace.id, "stripe")

    const relationshipId =
        String(formData.get("relationship_id") ?? "").trim() || null
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
        .filter((lineItem) => lineItem.amount > 0)
    const billableServiceKeys = lineItems.map((lineItem) => lineItem.serviceKey)

    const { data: relationship } = relationshipId
        ? await supabaseAdmin
              .from("relationships")
              .select("id")
              .eq("id", relationshipId)
              .eq("workspace_id", workspace.id)
              .maybeSingle()
        : { data: null }

    if (relationshipId && !relationship) {
        redirect(newInvoiceHref(workspace.slug, "create-failed", relationshipId))
    }

    if (!name || !email || !phone || billableServiceKeys.length === 0) {
        redirect(newInvoiceHref(workspace.slug, "missing-fields", relationshipId))
    }

    const totalAmount = lineItems.reduce(
        (total, lineItem) => total + lineItem.amount,
        0
    )

    if (currency === "usd" && totalAmount < 50) {
        redirect(newInvoiceHref(workspace.slug, "amount-too-low", relationshipId))
    }

    const { data: sale, error: saleError } = await supabaseAdmin
        .from("client_sales")
        .insert({
            workspace_id: workspace.id,
            relationship_id: relationshipId,
            client_name: name,
            client_email: email,
            client_phone: phone,
            service_keys: billableServiceKeys,
            line_items: lineItems,
            project_timeframe_days: projectTimeframeDays,
            currency,
            total_amount: totalAmount,
            status: "invoice_creating",
            raw_payload: {},
            created_by: user.id,
        })
        .select("id")
        .single()

    if (saleError || !sale) {
        redirect(newInvoiceHref(workspace.slug, "schema-missing", relationshipId))
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
            secretKey: stripeConfig.secret_key,
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
        if (relationshipId) {
            await Promise.all([
                supabaseAdmin
                    .from("relationships")
                    .update({
                        primary_person_name: name,
                        primary_email: email,
                        primary_phone: phone,
                        lifecycle_phase: "invoiced",
                        updated_at: new Date().toISOString(),
                    })
                    .eq("id", relationshipId)
                    .eq("workspace_id", workspace.id),
                supabaseAdmin.from("relationship_assets").insert({
                    workspace_id: workspace.id,
                    relationship_id: relationshipId,
                    asset_type: "invoice",
                    title: `Stripe invoice ${invoice.invoiceId}`,
                    description: `${lineItems.length} line item${lineItems.length === 1 ? "" : "s"} · ${currency.toUpperCase()} ${(totalAmount / 100).toFixed(2)}`,
                    external_url: invoice.hostedInvoiceUrl,
                    native_kind: "invoice",
                    native_id: sale.id,
                    metadata: {
                        stripe_invoice_id: invoice.invoiceId,
                        stripe_invoice_status: invoice.invoiceStatus,
                        invoice_pdf: invoice.invoicePdf,
                    },
                    created_by: user.id,
                }),
            ])
        }
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

        redirect(newInvoiceHref(workspace.slug, getSaleErrorCode(error), relationshipId))
    }

    redirect(workspaceHref(workspace.slug, `invoices?invoice=${invoiceId}`))
}
