import { timingSafeEqual } from "node:crypto"
import { processAppointmentNotificationOutbox } from "@/lib/appointment-notification-worker"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 300

async function processRequest(request: Request) {
    const expected = Buffer.from(process.env.CRON_SECRET?.trim() ?? "")
    const supplied = Buffer.from(request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "")
    if (!expected.length || expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return Response.json({ error: "Unauthorized" }, { status: 401 })
    try {
        const outcome = await processAppointmentNotificationOutbox({ limit: 5 })
        const ok = outcome.failed === 0
        return Response.json({ ok, ...outcome }, { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } })
    } catch { return Response.json({ error: "Could not process appointment notifications." }, { status: 503, headers: { "Cache-Control": "no-store" } }) }
}

export const GET = processRequest
export const POST = processRequest
