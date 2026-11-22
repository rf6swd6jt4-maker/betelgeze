import { after } from "next/server"
import { handleCampaignIntake, handleCampaignIntakePreflight, type CampaignIntakeDependencies } from "@/lib/campaigns/intake"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function dependencies(): CampaignIntakeDependencies {
    return {
        enabled: process.env.CAMPAIGN_INTAKE_ENABLED === "true",
        // Keys the HMAC of the visitor's IP used for rate limits. The IP itself is never stored.
        ipSecret: process.env.CAMPAIGN_INTAKE_IP_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || "",
        target: async key => {
            const { supabaseAdmin } = await import("@/lib/supabase/admin")
            const { data, error } = await supabaseAdmin.rpc("campaign_intake_target", { p_key: key })
            if (error) throw new Error("Could not read campaign.")
            return data ?? null
        },
        store: async (key, input) => {
            const { supabaseAdmin } = await import("@/lib/supabase/admin")
            const { data, error } = await supabaseAdmin.rpc("campaign_intake", { p_key: key, p_input: input })
            if (error || !data) throw new Error("Could not store lead.")
            return data
        },
    }
}

export async function OPTIONS(request: Request, context: { params: Promise<{ key: string }> }) {
    const { key } = await context.params
    return handleCampaignIntakePreflight(request, key, dependencies())
}

export async function POST(request: Request, context: { params: Promise<{ key: string }> }) {
    const { key } = await context.params
    const deps = dependencies()
    if (deps.enabled && !deps.ipSecret) return Response.json({ error: "Lead intake is unavailable. Nothing was stored." }, { status: 503, headers: { "Cache-Control": "no-store" } })
    const response = await handleCampaignIntake(request, key, deps)
    // An instant reply goes out right after the answer, not at the next minute (docs/text-flows.md).
    if (response.ok) after(async () => { const { kickFlows } = await import("@/lib/campaigns/flows-server"); await kickFlows() })
    return response
}
