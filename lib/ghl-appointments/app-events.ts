import "server-only"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { processGhlAppointmentAutomation } from "./worker"

export async function drainGhlAppEvents(eventKey?: string, immediate = false) {
    const { data, error } = await supabaseAdmin.rpc("ghl_app_event", { p_action: "drain", p_input: eventKey ? { eventKey } : {} })
    if (error || !data || data.failure) throw new Error("GHL app event processing could not complete.")
    // Contact fanout is durable and bounded. Wake one location now; the regular
    // appointment runner drains any remaining occurrences without re-expanding them.
    const wake = Array.isArray(data.wakes) ? data.wakes[0] : null
    if (immediate && wake && typeof wake.locationId === "string") await processGhlAppointmentAutomation({ locationId: wake.locationId })
    return { processed: Number(data.processed) || 0, more: data.more === true }
}
