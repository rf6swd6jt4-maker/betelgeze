import "server-only"
import { parseSopWorkPlan, SOP_WORK_INSTRUCTIONS, SOP_WORK_SCHEMA } from "./work-plan"
import type { SopInterpretation } from "./interpretation"

export async function generateSopWork(input: { model: string; source: SopInterpretation }, request: typeof fetch, retain: (text: string) => Promise<void>) {
    const response = await request("https://api.openai.com/v1/responses", {
        method: "POST", headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY?.trim()}`, "Content-Type": "application/json" }, signal: AbortSignal.timeout(90_000),
        body: JSON.stringify({ model: input.model, store: false, service_tier: "default", instructions: SOP_WORK_INSTRUCTIONS,
            input: [{ role: "user", content: [{ type: "input_text", text: JSON.stringify({ source: input.source }) }] }],
            max_output_tokens: 14000, text: { format: { type: "json_schema", name: "sop_work", strict: true, schema: SOP_WORK_SCHEMA } },
        }),
    })
    if (!response.ok) throw new Error(`OpenAI work generation failed (HTTP ${response.status}). No flow was generated.`)
    const body = await response.json() as { status?: string; output?: { type: string; content?: { type: string; text?: string }[] }[] }
    const content = body.output?.filter(item => item.type === "message").flatMap(item => item.content ?? []) ?? []
    const raw = content.filter(item => item.type === "output_text").map(item => item.text ?? "").join("")
    await retain(raw.slice(0, 200000))
    if (body.status !== "completed" || content.some(item => item.type === "refusal")) throw new Error("OpenAI did not finish the work plan. No flow was generated.")
    const plan = parseSopWorkPlan(JSON.parse(raw), input.source)
    if (plan.tasks.some(task => task.blocked_reason !== "")) throw new Error("The work plan asserted a client-specific blocker in generic mode.")
    return plan
}
