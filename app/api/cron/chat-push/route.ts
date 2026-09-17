import { timingSafeEqual } from "node:crypto"
import { after } from "next/server"
import { processChatPushDeliveries } from "@/lib/push/delivery"
export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 300
async function processRequest(request: Request) {
    const expected = Buffer.from((process.env.SOP_WORK_CRON_SECRET ?? process.env.CRON_SECRET)?.trim() ?? "")
    const supplied = Buffer.from(request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "")
    if (!expected.length || expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return Response.json({ error: "Unauthorized" }, { status: 401 })
    after(async () => {
        try {
            for (let n = 0; n < 4; n++) if ((await processChatPushDeliveries()).processed < 50) break
        } catch { console.error("Chat push recovery interrupted; leased jobs remain recoverable") }
    })
    return Response.json({ accepted: true }, { status: 202, headers: { "Cache-Control": "no-store" } })
}
export const GET = processRequest
export const POST = processRequest
