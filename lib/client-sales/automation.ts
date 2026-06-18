import { supabaseAdmin } from "@/lib/supabase/admin"
import { SERVICES } from "@/lib/onboarding/services"
import { createOnboardingClient } from "@/lib/onboarding/client-creation"
import { getEquivalentMessageAddresses } from "@/lib/client-messages/addresses"
import {
    sendMetaWhatsAppMessage,
    sendMetaWhatsAppTemplate,
} from "@/lib/client-messages/meta-whatsapp"
import { isConsentConfirmationText } from "@/lib/client-sales/consent"

type ClientSale = {
    id: string
    client_id: string | null
    client_name: string
    client_email: string | null
    client_phone: string
    service_keys: unknown
    project_timeframe_days: number | null
    status: string
}

type StripeInvoiceLike = {
    id?: unknown
    status?: unknown
    customer?: unknown
    amount_paid?: unknown
    hosted_invoice_url?: unknown
    invoice_pdf?: unknown
    metadata?: {
        client_sale_id?: string
    }
}

type ConfirmationInput = {
    fromAddress: string
    messageId?: string | null
    body: string
    rawPayload: unknown
}

function asStringArray(value: unknown) {
    return Array.isArray(value)
        ? value.filter((item): item is string => typeof item === "string")
        : []
}

function getWhatsAppMessageId(response: unknown) {
    const messages =
        response && typeof response === "object" && !Array.isArray(response)
            ? (response as { messages?: Array<{ id?: string }> }).messages
            : null

    return messages?.[0]?.id ?? null
}

async function addSaleActivity(
    saleId: string,
    activityText: string,
    rawPayload?: unknown
) {
    await supabaseAdmin
        .from("client_sales")
        .update({
            updated_at: new Date().toISOString(),
            raw_payload: rawPayload
                ? {
                      last_activity: activityText,
                      last_payload: rawPayload,
                  }
                : undefined,
        })
        .eq("id", saleId)
}

export async function sendSaleConsentTemplate(saleId: string) {
    const { data: sale } = await supabaseAdmin
        .from("client_sales")
        .select("id, client_phone, status, consent_template_sent_at")
        .eq("id", saleId)
        .single()

    if (!sale) return { ok: false, error: "Sale not found" }
    if (sale.consent_template_sent_at) return { ok: true, skipped: true }

    const templateName =
        process.env.META_WHATSAPP_CONSENT_TEMPLATE_NAME ??
        process.env.META_WHATSAPP_ONBOARDING_TEMPLATE_NAME
    const languageCode =
        process.env.META_WHATSAPP_CONSENT_TEMPLATE_LANGUAGE ??
        process.env.META_WHATSAPP_ONBOARDING_TEMPLATE_LANGUAGE ??
        "en"

    if (!templateName) {
        await supabaseAdmin
            .from("client_sales")
            .update({
                status: "paid_consent_template_failed",
                updated_at: new Date().toISOString(),
            })
            .eq("id", saleId)

        return {
            ok: false,
            error: "Missing META_WHATSAPP_CONSENT_TEMPLATE_NAME",
        }
    }

    const { data: messageLog } = await supabaseAdmin
        .from("client_messages")
        .insert({
            direction: "outbound",
            provider: "meta_whatsapp",
            to_address: sale.client_phone,
            body: "[WhatsApp consent template]",
            status: "sending",
            raw_payload: {
                client_sale_id: saleId,
                template_name: templateName,
                template_language: languageCode,
            },
        })
        .select("id")
        .single()

    try {
        const templateMessage = await sendMetaWhatsAppTemplate({
            to: sale.client_phone,
            templateName,
            languageCode,
        })
        const whatsappMessageId = getWhatsAppMessageId(templateMessage)

        await Promise.all([
            supabaseAdmin
                .from("client_messages")
                .update({
                    status: "sent",
                    provider_message_id: whatsappMessageId,
                    whatsapp_message_id: whatsappMessageId,
                    raw_payload: {
                        client_sale_id: saleId,
                        template_name: templateName,
                        template_language: languageCode,
                        meta_response: templateMessage,
                    },
                })
                .eq("id", messageLog?.id),
            supabaseAdmin
                .from("client_sales")
                .update({
                    status: "paid_awaiting_whatsapp_confirm",
                    consent_template_sent_at: new Date().toISOString(),
                    consent_template_message_id: whatsappMessageId,
                    updated_at: new Date().toISOString(),
                })
                .eq("id", saleId),
        ])

        return {
            ok: true,
            whatsappMessageId,
        }
    } catch (error) {
        const errorMessage =
            error instanceof Error
                ? error.message
                : "Unknown Meta WhatsApp template error"

        await Promise.all([
            supabaseAdmin
                .from("client_messages")
                .update({
                    status: "send_failed",
                    error: errorMessage,
                })
                .eq("id", messageLog?.id),
            supabaseAdmin
                .from("client_sales")
                .update({
                    status: "paid_consent_template_failed",
                    updated_at: new Date().toISOString(),
                })
                .eq("id", saleId),
        ])

        return {
            ok: false,
            error: errorMessage,
        }
    }
}

export async function handlePaidStripeInvoice(invoice: StripeInvoiceLike) {
    const invoiceId = typeof invoice.id === "string" ? invoice.id : null
    const saleId =
        typeof invoice.metadata?.client_sale_id === "string"
            ? invoice.metadata.client_sale_id
            : null

    let query = supabaseAdmin.from("client_sales").select("id, status").limit(1)

    if (saleId) {
        query = query.eq("id", saleId)
    } else if (invoiceId) {
        query = query.eq("stripe_invoice_id", invoiceId)
    } else {
        return { ok: false, error: "Invoice has no sale ID or invoice ID" }
    }

    const { data: sales } = await query
    const sale = sales?.[0]

    if (!sale) return { ok: false, error: "Sale not found for invoice" }

    if (
        sale.status === "whatsapp_confirmed" ||
        sale.status === "onboarding_created" ||
        sale.status === "onboarding_link_sent"
    ) {
        return { ok: true, skipped: true }
    }

    await supabaseAdmin
        .from("client_sales")
        .update({
            status: "paid",
            stripe_invoice_status:
                typeof invoice.status === "string" ? invoice.status : "paid",
            stripe_customer_id:
                typeof invoice.customer === "string" ? invoice.customer : null,
            stripe_hosted_invoice_url:
                typeof invoice.hosted_invoice_url === "string"
                    ? invoice.hosted_invoice_url
                    : null,
            stripe_invoice_pdf:
                typeof invoice.invoice_pdf === "string"
                    ? invoice.invoice_pdf
                    : null,
            raw_payload: invoice,
            updated_at: new Date().toISOString(),
        })
        .eq("id", sale.id)

    return sendSaleConsentTemplate(sale.id)
}

async function findPendingConfirmedSale(fromAddress: string) {
    const equivalentAddresses = getEquivalentMessageAddresses(fromAddress)
    const { data: sales } = await supabaseAdmin
        .from("client_sales")
        .select(
            "id, client_id, client_name, client_email, client_phone, service_keys, project_timeframe_days, status"
        )
        .in("client_phone", equivalentAddresses)
        .in("status", [
            "test_paid",
            "paid",
            "paid_awaiting_whatsapp_confirm",
            "paid_consent_template_failed",
            "whatsapp_confirmed",
            "onboarding_created",
            "onboarding_link_failed",
        ])
        .order("created_at", { ascending: false })
        .limit(1)

    return (sales?.[0] as ClientSale | undefined) ?? null
}

export async function handleSaleConsentConfirmation({
    fromAddress,
    messageId,
    body,
    rawPayload,
}: ConfirmationInput) {
    if (!isConsentConfirmationText(body)) {
        return { handled: false }
    }

    const sale = await findPendingConfirmedSale(fromAddress)

    if (!sale) return { handled: false }

    let clientId = sale.client_id
    let onboardingUrl: string | null = null

    if (!clientId) {
        const client = await createOnboardingClient({
            name: sale.client_name,
            email: sale.client_email,
            phone: fromAddress,
            serviceKeys: asStringArray(sale.service_keys).filter(
                (serviceKey) => serviceKey in SERVICES
            ),
            projectTimeframeDays: sale.project_timeframe_days,
            createClickUpResources: true,
            activitySource: `Stripe sale ${sale.id}`,
        })
        clientId = client.id
        onboardingUrl = client.onboardingUrl

        await supabaseAdmin
            .from("client_sales")
            .update({
                client_id: client.id,
                client_phone: fromAddress,
                status: "onboarding_created",
                consent_confirmed_at: new Date().toISOString(),
                consent_confirmed_message_id: messageId ?? null,
                updated_at: new Date().toISOString(),
            })
            .eq("id", sale.id)
    } else {
        const { data: client } = await supabaseAdmin
            .from("clients")
            .select("session_token")
            .eq("id", clientId)
            .single()

        onboardingUrl = client?.session_token
            ? `${process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"}/session/${client.session_token}`
            : null

        await supabaseAdmin
            .from("client_sales")
            .update({
                status: "onboarding_created",
                consent_confirmed_at: new Date().toISOString(),
                consent_confirmed_message_id: messageId ?? null,
                updated_at: new Date().toISOString(),
            })
            .eq("id", sale.id)
    }

    await supabaseAdmin.from("client_messages").insert({
        client_id: clientId,
        direction: "inbound",
        provider: "meta_whatsapp",
        provider_message_id: messageId ?? null,
        whatsapp_message_id: messageId ?? null,
        from_address: fromAddress,
        body,
        status: "whatsapp_consent_confirmed",
        raw_payload: rawPayload,
    })

    if (!onboardingUrl) {
        await addSaleActivity(sale.id, "WhatsApp confirmed but onboarding URL missing")
        return { handled: true, ok: false, error: "Onboarding URL missing" }
    }

    const outboundBody = [
        `Thanks ${sale.client_name}. Your onboarding link is ready:`,
        onboardingUrl,
    ].join("\n\n")
    const { data: messageLog } = await supabaseAdmin
        .from("client_messages")
        .insert({
            client_id: clientId,
            direction: "outbound",
            provider: "meta_whatsapp",
            to_address: fromAddress,
            body: outboundBody,
            status: "sending",
            raw_payload: {
                client_sale_id: sale.id,
                onboarding_url: onboardingUrl,
            },
        })
        .select("id")
        .single()

    try {
        const message = await sendMetaWhatsAppMessage({
            to: fromAddress,
            body: outboundBody,
        })
        const whatsappMessageId = getWhatsAppMessageId(message)

        await Promise.all([
            supabaseAdmin
                .from("client_messages")
                .update({
                    status: "sent",
                    provider_message_id: whatsappMessageId,
                    whatsapp_message_id: whatsappMessageId,
                })
                .eq("id", messageLog?.id),
            supabaseAdmin
                .from("client_sales")
                .update({
                    status: "onboarding_link_sent",
                    onboarding_link_sent_at: new Date().toISOString(),
                    onboarding_link_message_id: whatsappMessageId,
                    updated_at: new Date().toISOString(),
                })
                .eq("id", sale.id),
        ])

        return { handled: true, ok: true }
    } catch (error) {
        const errorMessage =
            error instanceof Error
                ? error.message
                : "Unknown onboarding link send error"

        await Promise.all([
            supabaseAdmin
                .from("client_messages")
                .update({
                    status: "send_failed",
                    error: errorMessage,
                })
                .eq("id", messageLog?.id),
            supabaseAdmin
                .from("client_sales")
                .update({
                    status: "onboarding_link_failed",
                    updated_at: new Date().toISOString(),
                })
                .eq("id", sale.id),
        ])

        return { handled: true, ok: false, error: errorMessage }
    }
}
