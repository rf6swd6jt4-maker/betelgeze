import { normalizeProviderAddress, resolvePrimaryMessagingProvider } from "@/lib/client-messages/addresses"
import {
    metaWhatsAppFailureIsSafeToRetry,
    sendMetaWhatsAppMedia,
    sendMetaWhatsAppMessage,
    sendMetaWhatsAppSticker,
    sendMetaWhatsAppTemplate,
} from "@/lib/client-messages/meta-whatsapp"
import { sendTwilioMessage, twilioFailureIsSafeToRetry } from "@/lib/client-messages/twilio"
import { formatWhatsAppAttributedMessage } from "@/lib/client-messages/whatsapp-attribution"
import type { CommunicationAttachment } from "@/lib/communications/types"
import { createPrivateUploadSignedUrl } from "@/lib/onboarding/uploads"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { smsConsentAllowsDelivery } from "@/lib/client-sales/sms-consent-state"

export type ClientMessageProvider = "meta_whatsapp" | "twilio_sms"
export type CommunicationDeliveryMode = "primary_only" | "primary_with_fallback" | "mirror"

export type ResolvedCommunicationDestination = {
    provider: ClientMessageProvider | "client_portal"
    address: string
    channelId: string | null
    primary: boolean
}

function providerLabel(provider: ClientMessageProvider | "client_portal") {
    return provider === "client_portal" ? "Client portal" : provider === "meta_whatsapp" ? "WhatsApp" : "SMS"
}

function providerMessageId(provider: ClientMessageProvider | "client_portal", value: unknown) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null
    if (provider === "twilio_sms") {
        const sid = (value as { sid?: unknown }).sid
        return typeof sid === "string" ? sid : null
    }
    const messages = (value as { messages?: unknown }).messages
    if (!Array.isArray(messages)) return null
    const first = messages[0]
    return first && typeof first === "object" && !Array.isArray(first) && typeof (first as { id?: unknown }).id === "string"
        ? (first as { id: string }).id
        : null
}

function attributedSmsBody(senderName: string | null | undefined, body: string) {
    const sender = senderName?.trim()
    return sender ? `${sender} via Betelgeze:\n${body}` : body
}

async function activeMessagingProviders(workspaceId: string) {
    const { data, error } = await supabaseAdmin
        .from("workspace_integrations")
        .select("provider")
        .eq("workspace_id", workspaceId)
        .eq("enabled", true)
        .in("provider", ["meta_whatsapp", "twilio_sms"])
    if (error) throw new Error(error.message)
    return new Set((data ?? []).map((item) => item.provider as ClientMessageProvider))
}

async function ensureChannel(input: {
    workspaceId: string
    relationshipId: string
    clientId: string | null
    provider: ClientMessageProvider
    address: string
}) {
    if (!input.clientId) return null
    const { data, error } = await supabaseAdmin.from("client_communication_channels").upsert({
        workspace_id: input.workspaceId,
        client_id: input.clientId,
        relationship_id: input.relationshipId,
        provider: input.provider,
        external_address: input.address,
        clickup_channel_id: null,
        is_active: true,
        updated_at: new Date().toISOString(),
    }, { onConflict: "workspace_id,client_id,provider" }).select("id").single()
    if (error) throw new Error(error.message)
    return data.id as string
}

export async function resolveCommunicationDestinations(input: {
    workspaceId: string
    relationshipId: string
    purpose?: "confirmation"
}) {
    const { data: relationship, error } = await supabaseAdmin
        .from("relationships")
        .select("id, client_id, primary_phone, whatsapp_phone, communication_primary_provider, communication_delivery_mode, status, source_metadata")
        .eq("workspace_id", input.workspaceId)
        .eq("id", input.relationshipId)
        .maybeSingle()
    if (error) throw new Error(error.message)
    if (!relationship || relationship.status === "archived") throw new Error("Conversation not found.")
    const requestedPrimaryProvider = (relationship.communication_primary_provider === "twilio_sms" ? "twilio_sms" : "meta_whatsapp") as ClientMessageProvider
    const primaryProvider = resolvePrimaryMessagingProvider({
        requestedProvider: requestedPrimaryProvider,
        smsPhone: relationship.primary_phone,
        whatsappPhone: relationship.whatsapp_phone,
    })
    const deliveryMode = (["primary_only", "primary_with_fallback", "mirror"] as const).includes(relationship.communication_delivery_mode as CommunicationDeliveryMode)
        ? relationship.communication_delivery_mode as CommunicationDeliveryMode
        : "mirror"
    const metadata = relationship.source_metadata as Record<string, unknown> | null
    if (input.purpose !== "confirmation" && metadata?.portal_handoff === "creator_dm" && metadata.external_messaging_pending === true) {
        const portal = await supabaseAdmin.from("client_portal_sessions").select("id, status, token_revoked_at")
            .eq("workspace_id", input.workspaceId).eq("relationship_id", input.relationshipId).maybeSingle()
        if (portal.error) throw new Error("Could not verify client portal access.")
        if (!portal.data || portal.data.status !== "active" || portal.data.token_revoked_at) throw new Error("Client portal access is unavailable.")
        return { relationship, primaryProvider, deliveryMode, availableProviders: [] as ClientMessageProvider[], destinations: [{ provider: "client_portal", address: `portal:${portal.data.id}`, channelId: null, primary: true }] as ResolvedCommunicationDestination[] }
    }
    const connected = await activeMessagingProviders(input.workspaceId)
    const addresses: Record<ClientMessageProvider, string> = {
        meta_whatsapp: normalizeProviderAddress("meta_whatsapp", relationship.whatsapp_phone ?? ""),
        twilio_sms: normalizeProviderAddress("twilio_sms", relationship.primary_phone ?? ""),
    }
    let selected = (["meta_whatsapp", "twilio_sms"] as ClientMessageProvider[])
        .filter((provider) => connected.has(provider) && Boolean(addresses[provider]))
        .sort((left, right) => Number(right === primaryProvider) - Number(left === primaryProvider))
    if (deliveryMode === "primary_only") selected = selected.filter((provider) => provider === primaryProvider)
    if (deliveryMode === "primary_with_fallback") selected = selected.slice(0, 1)
    const destinations: ResolvedCommunicationDestination[] = []
    for (const provider of selected) {
        destinations.push({
            provider,
            address: addresses[provider],
            channelId: await ensureChannel({
                workspaceId: input.workspaceId,
                relationshipId: relationship.id,
                clientId: relationship.client_id,
                provider,
                address: addresses[provider],
            }),
            primary: provider === primaryProvider,
        })
    }
    return {
        relationship,
        primaryProvider,
        deliveryMode,
        destinations,
        availableProviders: [...connected],
    }
}

async function replyProviderId(input: {
    workspaceId: string
    relationshipId: string
    replyToMessageId: string | null | undefined
    provider: ClientMessageProvider
}) {
    if (!input.replyToMessageId || input.provider === "twilio_sms") return null
    const delivery = await supabaseAdmin
        .from("communication_message_deliveries")
        .select("provider_message_id")
        .eq("workspace_id", input.workspaceId)
        .eq("client_message_id", input.replyToMessageId)
        .eq("provider", input.provider)
        .maybeSingle()
    if (!delivery.error && delivery.data?.provider_message_id) return delivery.data.provider_message_id
    const legacy = await supabaseAdmin
        .from("client_messages")
        .select("provider_message_id, whatsapp_message_id")
        .eq("workspace_id", input.workspaceId)
        .eq("relationship_id", input.relationshipId)
        .eq("id", input.replyToMessageId)
        .maybeSingle()
    if (legacy.error) throw new Error(legacy.error.message)
    return legacy.data?.whatsapp_message_id ?? legacy.data?.provider_message_id ?? null
}

async function sendProvider(input: {
    workspaceId: string
    relationshipId: string
    messageId: string
    destination: ResolvedCommunicationDestination
    body: string
    senderName?: string | null
    attachment?: CommunicationAttachment | null
    attachmentAccessUrl?: string | null
    replyToMessageId?: string | null
    whatsappTemplate?: { name: string; language: string } | null
    smsConsentContext?: "web_opt_in"
}) {
    if (input.destination.provider === "client_portal") return null
    const replyTo = await replyProviderId({
        workspaceId: input.workspaceId,
        relationshipId: input.relationshipId,
        replyToMessageId: input.replyToMessageId,
        provider: input.destination.provider,
    })
    if (input.destination.provider === "twilio_sms") {
        const consentAllowed = await smsConsentAllowsDelivery({
            workspaceId: input.workspaceId,
            relationshipId: input.relationshipId,
            address: input.destination.address,
            includeSending: input.smsConsentContext === "web_opt_in",
        })
        if (!consentAllowed) throw new Error("This client has not opted in to SMS messages for this relationship.")
        const mediaUrls = input.attachment && input.attachment.kind !== "sticker"
            ? [input.attachmentAccessUrl ?? await createPrivateUploadSignedUrl(input.attachment.storagePath)]
            : []
        const body = input.attachment?.kind === "sticker" && !input.body.trim()
            ? "A sticker was shared in your WhatsApp conversation."
            : input.body
        return sendTwilioMessage({
            workspaceId: input.workspaceId,
            to: input.destination.address,
            body: attributedSmsBody(input.senderName, body),
            mediaUrls,
            callbackData: input.messageId,
        })
    }
    if (input.whatsappTemplate) {
        return sendMetaWhatsAppTemplate({
            workspaceId: input.workspaceId,
            to: input.destination.address,
            templateName: input.whatsappTemplate.name,
            languageCode: input.whatsappTemplate.language,
            callbackData: input.messageId,
        })
    }
    const attributedBody = formatWhatsAppAttributedMessage(input.senderName, input.body)
    if (input.attachment?.kind === "sticker") {
        return sendMetaWhatsAppSticker({
            workspaceId: input.workspaceId,
            to: input.destination.address,
            link: input.attachmentAccessUrl ?? await createPrivateUploadSignedUrl(input.attachment.storagePath),
            replyToMessageId: replyTo,
            callbackData: input.messageId,
        })
    }
    if (input.attachment?.kind === "audio") {
        throw new Error("Voice notes can currently be received in chat but not sent from Betelgeze.")
    }
    if (input.attachment) {
        return sendMetaWhatsAppMedia({
            workspaceId: input.workspaceId,
            to: input.destination.address,
            kind: input.attachment.kind,
            link: input.attachmentAccessUrl ?? await createPrivateUploadSignedUrl(input.attachment.storagePath),
            caption: attributedBody,
            fileName: input.attachment.fileName,
            replyToMessageId: replyTo,
            callbackData: input.messageId,
        })
    }
    return sendMetaWhatsAppMessage({
        workspaceId: input.workspaceId,
        to: input.destination.address,
        body: attributedBody,
        replyToMessageId: replyTo,
        callbackData: input.messageId,
    })
}

export async function sendCommunicationDeliveries(input: {
    workspaceId: string
    relationshipId: string
    messageId: string
    body: string
    senderName?: string | null
    attachment?: CommunicationAttachment | null
    attachmentAccessUrl?: string | null
    replyToMessageId?: string | null
    whatsappTemplate?: { name: string; language: string } | null
    destinations?: ResolvedCommunicationDestination[]
    smsConsentContext?: "web_opt_in"
}) {
    const resolved = input.destinations
        ? null
        : await resolveCommunicationDestinations({ workspaceId: input.workspaceId, relationshipId: input.relationshipId })
    const destinations = input.destinations ?? resolved?.destinations ?? []
    if (!destinations.length) throw new Error("This relationship has no connected SMS or WhatsApp destination.")
    const results: Array<{
        provider: ClientMessageProvider | "client_portal"
        ok: boolean
        providerMessageId: string | null
        error: string | null
        safeToRetry: boolean
        primary: boolean
    }> = []
    for (const destination of destinations) {
        if (destination.provider === "client_portal") {
            // The encrypted client_messages row is the portal's durable message.
            // It is published through the existing portal reads and Realtime.
            results.push({ provider: "client_portal", ok: true, providerMessageId: null, error: null, safeToRetry: false, primary: true })
            continue
        }
        const existing = await supabaseAdmin.from("communication_message_deliveries")
            .select("id, provider_message_id, status, error")
            .eq("workspace_id", input.workspaceId)
            .eq("client_message_id", input.messageId)
            .eq("provider", destination.provider)
            .maybeSingle()
        if (existing.error) throw new Error(existing.error.message)
        if (existing.data && ["sent", "delivered", "read"].includes(existing.data.status)) {
            results.push({ provider: destination.provider, ok: true, providerMessageId: existing.data.provider_message_id, error: null, safeToRetry: false, primary: destination.primary })
            continue
        }
        if (existing.data && ["sending", "send_uncertain"].includes(existing.data.status)) {
            results.push({ provider: destination.provider, ok: false, providerMessageId: existing.data.provider_message_id, error: existing.data.error ?? `${providerLabel(destination.provider)} delivery is still being confirmed.`, safeToRetry: false, primary: destination.primary })
            continue
        }
        const delivery = await supabaseAdmin.from("communication_message_deliveries").upsert({
            workspace_id: input.workspaceId,
            relationship_id: input.relationshipId,
            client_message_id: input.messageId,
            communication_channel_id: destination.channelId,
            provider: destination.provider,
            destination: destination.address,
            status: "sending",
            error: null,
            failed_at: null,
            updated_at: new Date().toISOString(),
        }, { onConflict: "client_message_id,provider" }).select("id").single()
        if (delivery.error) throw new Error(delivery.error.message)
        let accepted = false
        let acceptedProviderMessageId: string | null = null
        try {
            const response = await sendProvider({ ...input, destination })
            accepted = true
            const externalId = providerMessageId(destination.provider, response)
            acceptedProviderMessageId = externalId
            const sentAt = new Date().toISOString()
            const receipt = await supabaseAdmin.from("communication_message_deliveries").update({
                provider_message_id: externalId,
                status: "sent",
                sent_at: sentAt,
                error: null,
                raw_payload: { provider_response: response },
                updated_at: sentAt,
            }).eq("id", delivery.data.id)
            if (receipt.error) throw new Error("The provider accepted this message, but its delivery receipt could not be saved. Review delivery before retrying.")
            results.push({ provider: destination.provider, ok: true, providerMessageId: externalId, error: null, safeToRetry: false, primary: destination.primary })
        } catch (error) {
            const safeToRetry = !accepted && (destination.provider === "meta_whatsapp"
                ? metaWhatsAppFailureIsSafeToRetry(error)
                : twilioFailureIsSafeToRetry(error))
            const message = error instanceof Error ? error.message : `${providerLabel(destination.provider)} send failed.`
            const failedAt = new Date().toISOString()
            await supabaseAdmin.from("communication_message_deliveries").update({
                ...(accepted ? { provider_message_id: acceptedProviderMessageId } : {}),
                status: safeToRetry ? "send_failed" : "send_uncertain",
                error: message,
                failed_at: safeToRetry ? failedAt : null,
                updated_at: failedAt,
            }).eq("id", delivery.data.id)
            results.push({ provider: destination.provider, ok: false, providerMessageId: acceptedProviderMessageId, error: message, safeToRetry, primary: destination.primary })
        }
    }
    const succeeded = results.filter((result) => result.ok)
    const primary = results.find((result) => result.primary && result.ok) ?? succeeded[0] ?? results.find((result) => result.primary) ?? results[0]
    const whatsapp = results.find((result) => result.provider === "meta_whatsapp" && result.ok)
    const aggregateStatus = succeeded.length === results.length
        ? "sent"
        : results.some((result) => !result.ok && !result.safeToRetry)
            ? "send_uncertain"
            : succeeded.length ? "partial_sent" : "send_failed"
    const aggregateError = results.filter((result) => result.error).map((result) => `${providerLabel(result.provider)}: ${result.error}`).join(" · ") || null
    const now = new Date().toISOString()
    const update = await supabaseAdmin.from("client_messages").update({
        provider: results.length > 1 ? "omnichannel" : results[0].provider,
        provider_message_id: primary?.providerMessageId ?? null,
        whatsapp_message_id: whatsapp?.providerMessageId ?? null,
        status: aggregateStatus,
        error: aggregateError,
        sent_at: succeeded.length ? now : null,
        failed_at: succeeded.length ? null : now,
    }).eq("workspace_id", input.workspaceId).eq("id", input.messageId)
    // Provider outcomes are authoritative. The delivery rows retain the receipt
    // even if updating the aggregate message fails; do not invite a duplicate send.
    if (update.error && results.some((result) => result.provider === "client_portal")) throw new Error("Could not confirm portal message delivery. Please retry.")
    if (update.error) console.error("Could not record communication delivery summary", { messageId: input.messageId, error: update.error.message })
    return { results, status: aggregateStatus, error: aggregateError, persistenceError: update.error?.message ?? null }
}
