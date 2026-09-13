import { timingSafeEqual } from "node:crypto"
import { processSopInterpretation } from "@/lib/sops/interpretation-worker"
export const dynamic = "force-dynamic"
export const runtime = "nodejs"
export const maxDuration = 300
async function processRequest(request: Request) {
    const expected = Buffer.from(process.env.CRON_SECRET?.trim() ?? ""), supplied = Buffer.from(request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "")
    if (!expected.length || supplied.length !== expected.length || !timingSafeEqual(expected, supplied)) return Response.json({ error: "Unauthorized" }, { status: 401 })
    try { return Response.json(await processSopInterpretation(), { headers: { "Cache-Control": "no-store" } }) }
    catch { return Response.json({ error: "Interpretation recovery failed." }, { status: 503, headers: { "Cache-Control": "no-store" } }) }
}
export const GET = processRequest
export const POST = processRequest
