import { timingSafeEqual } from "node:crypto"
import { processGhlAppointmentAutomation } from "@/lib/ghl-appointments/worker"
import { drainGhlAppEvents } from "@/lib/ghl-appointments/app-events"
import { after } from "next/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 300

async function processRequest(request: Request) {
    const expected = Buffer.from((process.env.SOP_WORK_CRON_SECRET ?? process.env.CRON_SECRET)?.trim() ?? "")
    const supplied = Buffer.from(request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "")
    const headers = { "Cache-Control": "no-store" }
    if (!expected.length || expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return Response.json({ error: "Unauthorized" }, { status: 401, headers })
    if (process.env.GHL_APPOINTMENT_DETECTION_ENABLED !== "true") return Response.json({ disabled: true }, { headers })
    after(async () => {
        try {
            await drainGhlAppEvents()
            const outcome = await processGhlAppointmentAutomation()
            if (outcome.failed || outcome.attention) console.error("GHL scheduled processing requires attention.")
        } catch { console.error("GHL scheduled processing retained for recovery.") }
    })
    return Response.json({ accepted: true }, { status: 202, headers })
}
export const GET = processRequest
export const POST = processRequest
