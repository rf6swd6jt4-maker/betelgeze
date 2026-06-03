"use server"

import { redirect } from "next/navigation"
import { randomBytes } from "crypto"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { MODULES } from "@/lib/onboarding/modules"
import { requireAdmin } from "@/lib/admin/auth"
import { normalizeMessageAddress } from "@/lib/client-messages/addresses"
import {
    createClickUpChatChannel,
    hasClickUpConfig,
} from "@/lib/client-messages/clickup"

function getChannelId(response: unknown): string | null {
    if (!response || typeof response !== "object") return null

    const value = response as {
        id?: string
        data?: { id?: string }
        channel?: { id?: string }
    }

    return value.id ?? value.data?.id ?? value.channel?.id ?? null
}

async function addActivity(
    clientId: string,
    activityType: string,
    activityText: string
) {
    await supabaseAdmin.from("client_activity").insert({
        client_id: clientId,
        activity_type: activityType,
        activity_text: activityText,
    })
}

export async function createClient(formData: FormData) {
    await requireAdmin()

    const name = String(formData.get("name") ?? "").trim()
    const email = String(formData.get("email") ?? "").trim().toLowerCase()
    const phone = normalizeMessageAddress(String(formData.get("phone") ?? ""))
    const selectedModules = formData
        .getAll("modules")
        .map(String)
        .filter((moduleKey) => moduleKey in MODULES)

    if (!name || !phone) {
        redirect("/admin/new?error=missing-fields")
    }

    if (selectedModules.length === 0) {
        redirect("/admin/new?error=no-modules")
    }

    const sessionToken = randomBytes(32).toString("hex")

    const { data: client, error: clientError } = await supabaseAdmin
        .from("clients")
        .insert({
            name,
            email: email || null,
            phone,
            session_token: sessionToken,
        })
        .select("id, session_token")
        .single()

    if (clientError || !client) {
        redirect("/admin/new?error=create-failed")
    }

    const moduleRows = selectedModules.map((moduleKey) => ({
        client_id: client.id,
        module_key: moduleKey,
    }))

    const { error: modulesError } = await supabaseAdmin
        .from("client_modules")
        .insert(moduleRows)

    if (modulesError) {
        redirect("/admin/new?error=modules-failed")
    }

    let clickupChannelId: string | null = null

    if (hasClickUpConfig()) {
        try {
            const clickupChannel = await createClickUpChatChannel({
                name: `Client - ${name}`,
                description: `Client communication channel for ${name}.`,
                topic: "Client fulfilment communication",
            })

            clickupChannelId = getChannelId(clickupChannel)

            if (clickupChannelId) {
                await supabaseAdmin
                    .from("client_communication_channels")
                    .upsert(
                        {
                            client_id: client.id,
                            provider: "meta_whatsapp",
                            external_address: phone,
                            clickup_workspace_id:
                                process.env.CLICKUP_WORKSPACE_ID ?? null,
                            clickup_channel_id: clickupChannelId,
                            is_active: true,
                            updated_at: new Date().toISOString(),
                        },
                        {
                            onConflict: "client_id",
                        }
                    )

                await addActivity(
                    client.id,
                    "clickup_channel_created",
                    "ClickUp Chat channel created"
                )
            }
        } catch (error) {
            await addActivity(
                client.id,
                "clickup_channel_failed",
                error instanceof Error
                    ? `ClickUp Chat channel failed: ${error.message}`
                    : "ClickUp Chat channel failed"
            )
        }
    }

    const baseUrl =
        process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"
    const onboardingUrl = `${baseUrl}/session/${client.session_token}`

    await addActivity(
        client.id,
        "onboarding_link_created",
        `Onboarding link created: ${onboardingUrl}`
    )

    redirect(`/admin?created=${client.session_token}`)
}
