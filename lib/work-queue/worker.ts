import "server-only"
import { createHash } from "node:crypto"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { ASSESSMENT_INSTRUCTIONS, ASSESSMENT_SCHEMA, parseAssessment, QUEUE_MODEL, QUEUE_POLICY } from "./ranking"

export function queueAiConfiguration() {
    const dailyLimit = Number(process.env.QUEUE_AI_DAILY_LIMIT ?? 500)
    return { enabled: process.env.QUEUE_AI_ENABLED === "true" && Boolean(process.env.OPENAI_API_KEY?.trim()), dailyLimit: Number.isInteger(dailyLimit) && dailyLimit >= 1 && dailyLimit <= 5000 ? dailyLimit : 500 }
}
export async function processQueueAssessment(request: typeof fetch = fetch) {
    const config = queueAiConfiguration()
    if (!config.enabled) return { processed: 0 }
    const claim = await supabaseAdmin.rpc("claim_queue_assessment", { p_model: QUEUE_MODEL, p_policy: QUEUE_POLICY, p_daily_limit: config.dailyLimit })
    if (claim.error) throw new Error("Could not claim queue assessment")
    const job = claim.data?.[0] as { work_item_id: string; workspace_id: string; lease_token: string; fingerprint: string | null; assessment: unknown } | undefined
    if (!job) return { processed: 0 }
    let received = false
    let dispatched = false
    const usage = async (values: object) => {
        const saved = await supabaseAdmin.from("work_queue_ai_usage").update(values).eq("id", job.lease_token)
        if (saved.error) throw new Error("Could not confirm assessment usage")
    }
    try {
        const context = await supabaseAdmin.rpc("queue_assessment_context", { p_workspace: job.workspace_id, p_item: job.work_item_id })
        if (context.error || !context.data) throw new Error("Work context is unavailable")
        const input = JSON.stringify(context.data)
        if (input.length > 90000) throw new Error("Work context exceeds the assessment allowance")
        const fingerprint = createHash("sha256").update(QUEUE_MODEL + QUEUE_POLICY + input).digest("hex")
        let assessment
        if (job.fingerprint === fingerprint && job.assessment) {
            assessment = parseAssessment(job.assessment)
            await usage({ status: "received", input_tokens: 0, output_tokens: 0, cost_usd: 0 })
            received = true
        } else {
            dispatched = true
            const response = await request("https://api.openai.com/v1/responses", {
                method: "POST", headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY!.trim()}`, "Content-Type": "application/json" }, signal: AbortSignal.timeout(65000),
                body: JSON.stringify({ model: QUEUE_MODEL, store: false, service_tier: "default", reasoning: { effort: "low" }, instructions: ASSESSMENT_INSTRUCTIONS,
                    input: [{ role: "user", content: [{ type: "input_text", text: input }] }], max_output_tokens: 4000,
                    text: { format: { type: "json_schema", name: "work_assessment", strict: true, schema: ASSESSMENT_SCHEMA } },
                }),
            })
            if (!response.ok) throw new Error("Assessment provider rejected the request")
            const body = await response.json() as { status?: string; output?: { type: string; content?: { type: string; text?: string }[] }[]; usage?: { input_tokens?: number; output_tokens?: number } }
            const i = body.usage?.input_tokens, o = body.usage?.output_tokens
            await usage({ status: "received", input_tokens: i ?? null, output_tokens: o ?? null, cost_usd: i !== undefined && o !== undefined ? (i * .75 + o * 4.5) / 1e6 : null })
            received = true
            const content = body.output?.filter(x => x.type === "message").flatMap(x => x.content ?? []) ?? []
            if (body.status !== "completed" || content.some(x => x.type === "refusal")) throw new Error("Assessment did not finish")
            assessment = parseAssessment(JSON.parse(content.filter(x => x.type === "output_text").map(x => x.text ?? "").join("")))
        }
        const saved = await supabaseAdmin.rpc("finish_queue_assessment", { p_item: job.work_item_id, p_lease: job.lease_token, p_fingerprint: fingerprint, p_assessment: assessment })
        if (saved.error || !saved.data) throw new Error("Assessment result was not confirmed")
        return { processed: 1 }
    } catch {
        if (!received) await usage({ status: dispatched ? "unknown" : "received", ...(!dispatched ? { input_tokens: 0, output_tokens: 0, cost_usd: 0 } : {}) }).catch(() => {})
        await supabaseAdmin.rpc("finish_queue_assessment", { p_item: job.work_item_id, p_lease: job.lease_token, p_fingerprint: null, p_assessment: null, p_error: "Assessment could not be confirmed. Saved recommendations remain available; a source change queues a new attempt." })
        return { processed: 1 }
    }
}
