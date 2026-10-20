import { handleGhlAppointmentWebhook } from "@/lib/ghl-appointments/webhook"
import { after } from "next/server"
import { processGhlAppointmentAutomation } from "@/lib/ghl-appointments/worker"
import { drainGhlAppEvents } from "@/lib/ghl-appointments/app-events"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 300

export async function POST(request: Request) {
    return handleGhlAppointmentWebhook(request, {
        enabled: process.env.GHL_APPOINTMENT_DETECTION_ENABLED === "true",
        appId: process.env.GHL_OAUTH_APP_ID,
        ingestAppEvent: async event => {
            const { supabaseAdmin } = await import("@/lib/supabase/admin")
            const { data, error } = await supabaseAdmin.rpc("ghl_app_event", { p_action: "ingest", p_input: event })
            if (error || !data) throw new Error("Could not retain app event.")
            if (data.accepted === true) after(async () => {
                try { await drainGhlAppEvents(event.eventKey, true) }
                catch { console.error("GHL app event retained for scheduled recovery.") }
            })
            return data
        },
        ingest: async event => {
            const { supabaseAdmin } = await import("@/lib/supabase/admin")
            const { data, error } = await supabaseAdmin.rpc("ghl_appointment_automation", { p_action: "ingest", p_input: event })
            if (error || !data) throw new Error("Could not retain event.")
            if (data.accepted === true && data.queued > 0) after(async () => {
                try { await processGhlAppointmentAutomation({ locationId: event.locationId, appointmentId: event.appointmentId }) }
                catch { console.error("GHL appointment event retained for scheduled recovery.") }
            })
            return data
        },
    })
}
