import "server-only"
import { parseSopWorkPlan, workEvidence, SOP_WORK_INSTRUCTIONS, SOP_WORK_SCHEMA } from "./work-plan"
import type { SopInterpretation } from "./interpretation"

export async function generateSopWork(input: { model: string; evidence: unknown; source: SopInterpretation }, request: typeof fetch) {
    const evidence = workEvidence(input.evidence)
    const response = await request("https://api.openai.com/v1/responses", {
        method: "POST", headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY?.trim()}`, "Content-Type": "application/json" }, signal: AbortSignal.timeout(90_000),
        body: JSON.stringify({ model: input.model, store: false, service_tier: "default", instructions: SOP_WORK_INSTRUCTIONS,
            input: [{ role: "user", content: [{ type: "input_text", text: JSON.stringify({ source: input.source, evidence }) }] }],
            max_output_tokens: 14000, text: { format: { type: "json_schema", name: "sop_work", strict: true, schema: SOP_WORK_SCHEMA } },
        }),
    })
    if (!response.ok) throw new Error(`OpenAI work generation failed (HTTP ${response.status}). Check the usage report before retrying.`)
    const body = await response.json() as { status?: string; output?: { type: string; content?: { type: string; text?: string }[] }[] }
    const content = body.output?.filter(item => item.type === "message").flatMap(item => item.content ?? []) ?? []
    if (body.status !== "completed" || content.some(item => item.type === "refusal")) throw new Error("OpenAI did not finish the work plan. Check the usage report before retrying.")
    const plan = parseSopWorkPlan(JSON.parse(content.filter(item => item.type === "output_text").map(item => item.text ?? "").join("")), input.source)
    if (evidence.omittedSensitiveFields) plan.warnings = [...plan.warnings.slice(0, 19), "Credential and private file-location fields were omitted from the client evidence."]
    return plan
}
