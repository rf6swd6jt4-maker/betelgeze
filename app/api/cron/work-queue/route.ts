import { processQueueFeedback, processQueueFeedbackFast } from "@/lib/work-queue/feedback-worker"
import { after } from "next/server"
import { processQueueCompletion } from "@/lib/work-queue/completion"
import { timingSafeEqual } from "node:crypto"
import { processQueueAssessment } from "@/lib/work-queue/worker"
export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 300
async function processRequest(request: Request) {
    const expected = Buffer.from((process.env.SOP_WORK_CRON_SECRET ?? process.env.CRON_SECRET)?.trim() ?? ""), supplied = Buffer.from(request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "")
    if (!expected.length || expected.length !== supplied.length || !timingSafeEqual(expected,supplied)) return Response.json({ error: "Unauthorized" }, { status: 401 })
    after(async () => {
        try {
            await processQueueCompletion()
            await processQueueFeedbackFast()
            await processQueueFeedback("dispute")
            for (let n=0;n<3;n++) { if (!(await processQueueAssessment()).processed) break }
        } catch { console.error("Queue worker could not confirm processing; durable jobs remain available.") }
    })
    return Response.json({ accepted: true }, { status: 202, headers: { "Cache-Control": "no-store" } })
}

export const GET = processRequest
export const POST = processRequest
