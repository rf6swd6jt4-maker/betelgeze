import { after } from "next/server"
import { timingSafeEqual } from "node:crypto"
import { processSopWork } from "@/lib/sops/work-worker"
export const dynamic = "force-dynamic"
export const runtime = "nodejs"
export const maxDuration = 300
async function processRequest(request: Request) {
    const expected = Buffer.from((process.env.SOP_WORK_CRON_SECRET ?? process.env.CRON_SECRET)?.trim() ?? ""), supplied = Buffer.from(request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "")
    if (!expected.length || supplied.length !== expected.length || !timingSafeEqual(expected, supplied)) return Response.json({ error: "Unauthorized" }, { status: 401 })
    after(async () => {
        try { await processSopWork() }
        catch { console.error("SOP worker could not confirm processing; durable recovery remains pending.") }
    })
    return Response.json({ accepted: true }, { status: 202, headers: { "Cache-Control": "no-store" } })
}
export const GET = processRequest
export const POST = processRequest
