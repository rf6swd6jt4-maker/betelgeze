import { getRequiredEnv } from "@/lib/env"
import { verifyStripeWebhookSignature } from "@/lib/stripe/signature"
import { getStripeCustomerPhone } from "@/lib/stripe/format"

const STRIPE_API_BASE = "https://api.stripe.com/v1"

type StripeRequestOptions = {
    method?: "GET" | "POST"
    params?: Record<string, string | number | boolean | null | undefined>
}

export type StripeInvoiceLineItemInput = {
    serviceKey: string
    description: string
    amount: number
}

export type CreateStripeInvoiceInput = {
    saleId: string
    name: string
    email?: string | null
    phone?: string | null
    currency: string
    lineItems: StripeInvoiceLineItemInput[]
    serviceKeys: string[]
    projectTimeframeDays?: number | null
    daysUntilDue: number
}

export type StripeInvoiceResult = {
    customerId: string
    invoiceId: string
    invoiceStatus: string | null
    hostedInvoiceUrl: string | null
    invoicePdf: string | null
    rawInvoice: unknown
}

export type StripeWebhookEvent = {
    id: string
    type: string
    data?: {
        object?: Record<string, unknown>
    }
}

function getStripeSecretKey() {
    return getRequiredEnv("STRIPE_SECRET_KEY")
}

export function hasStripeConfig() {
    return Boolean(process.env.STRIPE_SECRET_KEY)
}

function appendStripeParam(
    params: URLSearchParams,
    key: string,
    value: string | number | boolean | null | undefined
) {
    if (value === null || value === undefined) return

    params.append(key, String(value))
}

async function stripeRequest(
    path: string,
    { method = "POST", params = {} }: StripeRequestOptions = {}
) {
    const body = new URLSearchParams()

    for (const [key, value] of Object.entries(params)) {
        appendStripeParam(body, key, value)
    }

    const response = await fetch(`${STRIPE_API_BASE}${path}`, {
        method,
        headers: {
            Authorization: `Bearer ${getStripeSecretKey()}`,
            "Content-Type": "application/x-www-form-urlencoded",
        },
        body: method === "POST" ? body.toString() : undefined,
    })
    const responseBody = await response.text()

    if (!response.ok) {
        throw new Error(
            `Stripe ${path} failed with ${response.status}: ${responseBody}`
        )
    }

    return responseBody ? JSON.parse(responseBody) : null
}

function asStripeId(response: unknown, label: string) {
    const id =
        response && typeof response === "object" && !Array.isArray(response)
            ? (response as { id?: unknown }).id
            : null

    if (typeof id !== "string" || !id.trim()) {
        throw new Error(`Stripe did not return a ${label} ID`)
    }

    return id
}

function getInvoiceFields(invoice: unknown) {
    const value =
        invoice && typeof invoice === "object" && !Array.isArray(invoice)
            ? (invoice as {
                  id?: unknown
                  status?: unknown
                  hosted_invoice_url?: unknown
                  invoice_pdf?: unknown
              })
            : {}

    return {
        invoiceId:
            typeof value.id === "string" && value.id.trim()
                ? value.id.trim()
                : null,
        invoiceStatus:
            typeof value.status === "string" ? value.status : null,
        hostedInvoiceUrl:
            typeof value.hosted_invoice_url === "string"
                ? value.hosted_invoice_url
                : null,
        invoicePdf:
            typeof value.invoice_pdf === "string" ? value.invoice_pdf : null,
    }
}

export async function createAndSendStripeInvoice({
    saleId,
    name,
    email,
    phone,
    currency,
    lineItems,
    serviceKeys,
    projectTimeframeDays,
    daysUntilDue,
}: CreateStripeInvoiceInput): Promise<StripeInvoiceResult> {
    const customer = await stripeRequest("/customers", {
        params: {
            name,
            email: email || undefined,
            phone: getStripeCustomerPhone(phone),
            "metadata[client_sale_id]": saleId,
        },
    })
    const customerId = asStripeId(customer, "customer")

    for (const lineItem of lineItems) {
        await stripeRequest("/invoiceitems", {
            params: {
                customer: customerId,
                amount: lineItem.amount,
                currency,
                description: lineItem.description,
                "metadata[client_sale_id]": saleId,
                "metadata[service_key]": lineItem.serviceKey,
            },
        })
    }

    const invoice = await stripeRequest("/invoices", {
        params: {
            customer: customerId,
            collection_method: "send_invoice",
            days_until_due: daysUntilDue,
            pending_invoice_items_behavior: "include",
            "metadata[client_sale_id]": saleId,
            "metadata[service_keys]": serviceKeys.join(","),
            "metadata[project_timeframe_days]":
                projectTimeframeDays ?? undefined,
        },
    })
    const draftInvoiceId = asStripeId(invoice, "invoice")

    const finalizedInvoice = await stripeRequest(
        `/invoices/${encodeURIComponent(draftInvoiceId)}/finalize`
    )
    const { invoiceId } = getInvoiceFields(finalizedInvoice)

    if (!invoiceId) {
        throw new Error("Stripe did not return a finalized invoice ID")
    }

    const sentInvoice = await stripeRequest(
        `/invoices/${encodeURIComponent(invoiceId)}/send`
    )
    const sentFields = getInvoiceFields(sentInvoice)

    return {
        customerId,
        invoiceId,
        invoiceStatus: sentFields.invoiceStatus,
        hostedInvoiceUrl: sentFields.hostedInvoiceUrl,
        invoicePdf: sentFields.invoicePdf,
        rawInvoice: sentInvoice,
    }
}

export { verifyStripeWebhookSignature }
