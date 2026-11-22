import { after } from "next/server"
import { timingSafeEqual } from "node:crypto"
import { processFlowRuns } from "@/lib/campaigns/flows-server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 120

/**
 * Text flows' worker (docs/text-flows.md), called by the minute scheduler (dispatch_campaign_flows) only when a run is
 * due. Same credential as the other workers. It answers at once and works through due runs after the answer.
 */
async function processRequest(request: Request) {
    const expected = Buffer.from((process.env.SOP_WORK_CRON_SECRET ?? process.env.CRON_SECRET)?.trim() ?? "")
    const supplied = Buffer.from(request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "")
    const headers = { "Cache-Control": "no-store" }
    if (!expected.length || expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return Response.json({ error: "Unauthorized" }, { status: 401, headers })
    after(async () => {
        try {
            const outcome = await processFlowRuns({ limit: 50, budgetMs: 90_000 })
            if (outcome.failed) console.warn("Text flows: some runs will be retried.", outcome.failed)
        } catch { console.error("Text flows: the worker could not claim runs; the scheduler retries.") }
    })
    return Response.json({ accepted: true }, { status: 202, headers })
}
export const GET = processRequest
export const POST = processRequest
