import { timingSafeEqual } from "node:crypto"
import { renewGhlConnections } from "@/lib/ghl-oauth/server"
import { after } from "next/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 180
async function handle(request: Request) {
    const expected = Buffer.from((process.env.SOP_WORK_CRON_SECRET ?? process.env.CRON_SECRET)?.trim() ?? ""), supplied = Buffer.from(request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "")
    const headers = { "Cache-Control": "no-store" }
    if (!expected.length || expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return Response.json({ error: "Unauthorized" }, { status: 401, headers })
    if (process.env.GHL_OAUTH_ENABLED !== "true") return Response.json({ disabled: true }, { headers })
    after(async () => {
        try { const result = await renewGhlConnections(); if (result.attention) console.error("GHL token renewal requires reconnection.") }
        catch { console.error("GHL token renewal could not complete.") }
    })
    return Response.json({ accepted: true }, { status: 202, headers })
}
export const GET = handle
export const POST = handle
