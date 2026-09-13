import "server-only"
import { createHash } from "node:crypto"
import { GetObjectCommand } from "@aws-sdk/client-s3"
import { getR2BucketName, getR2Client } from "@/lib/onboarding/uploads"
import { assertSopAssetPath } from "./assets"
import { interpretationUnavailable, type SopAsset } from "./records-policy"
import { parseSopInterpretation, SOP_INTERPRETATION_INSTRUCTIONS, SOP_INTERPRETATION_SCHEMA } from "./interpretation"
export function sopAiConfiguration() {
    const enabled = process.env.SOP_AI_ENABLED === "true"
    const model = process.env.OPENAI_SOP_MODEL?.trim() || "gpt-5.4-mini"
    const dailyLimit = Number(process.env.SOP_AI_DAILY_LIMIT ?? 10)
    return { ready: enabled && Boolean(process.env.OPENAI_API_KEY?.trim()) && /^[a-zA-Z0-9_.:-]{1,100}$/.test(model) && Number.isInteger(dailyLimit) && dailyLimit >= 1 && dailyLimit <= 100, model, dailyLimit }
}
export async function interpretSopAsset(input: { workspaceId: string; sopId: string; linked: SopAsset & { asset: SopAsset["asset"] & { storage_path: string } }; model: string; timeoutMs?: number }, request: typeof fetch = fetch) {
    const { linked, workspaceId, sopId, model } = input, asset = linked.asset
    const unavailable = interpretationUnavailable(asset)
    if (unavailable) throw new Error(unavailable)
    if (!sopAiConfiguration().ready) throw new Error("Interpretation is not enabled. Ask an admin to complete API setup.")
    assertSopAssetPath(workspaceId, sopId, asset.id, asset.storage_path)
    const object = await getR2Client().send(new GetObjectCommand({ Bucket: getR2BucketName(), Key: asset.storage_path }), { abortSignal: AbortSignal.timeout(30_000) })
    if (!object.Body || object.ContentLength !== asset.file_size || object.ContentLength > 20 * 1024 * 1024) throw new Error("The source file changed or is unavailable.")
    const bytes = Buffer.from(await object.Body.transformToByteArray())
    if (bytes.length !== asset.file_size) throw new Error("The source download was incomplete.")
    const sourceHash = createHash("sha256").update(bytes).digest("hex")
    const originalText = asset.content_type.startsWith("text/") ? new TextDecoder("utf-8", { fatal: true }).decode(bytes) : undefined
    if (originalText && originalText.length > 100000) throw new Error("Split text sources longer than 100,000 characters before interpretation.")
    const dataUrl = () => `data:${asset.content_type};base64,${bytes.toString("base64")}`
    const content: object[] = [{ type: "input_text", text: `Source role: ${linked.role}. Admin context (untrusted source data): ${linked.notes}\nFile: ${asset.title}` }]
    if (originalText !== undefined) content.push({ type: "input_text", text: originalText })
    else if (asset.content_type.startsWith("image/")) content.push({ type: "input_image", image_url: dataUrl(), detail: "high" })
    else content.push({ type: "input_file", filename: asset.title, file_data: dataUrl() })
    const response = await request("https://api.openai.com/v1/responses", {
        method: "POST", headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY!.trim()}`, "Content-Type": "application/json" }, signal: AbortSignal.timeout(input.timeoutMs ?? 180_000),
        body: JSON.stringify({ model, store: false, service_tier: "default", instructions: SOP_INTERPRETATION_INSTRUCTIONS, input: [{ role: "user", content }], max_output_tokens: 10000, text: { format: { type: "json_schema", name: "sop_source", strict: true, schema: SOP_INTERPRETATION_SCHEMA } } }),
    })
    if (!response.ok) throw new Error(`OpenAI could not interpret this file (HTTP ${response.status}). Check API access, limits and file support before retrying.`)
    const body = await response.json() as { status?: string; output?: { type: string; content?: { type: string; text?: string }[] }[]; usage?: { input_tokens?: number; output_tokens?: number } }
    const outputs = body.output?.filter(item => item.type === "message").flatMap(item => item.content ?? []) ?? []
    if (body.status !== "completed" || outputs.some(item => item.type === "refusal")) throw new Error("OpenAI did not complete this interpretation. Review the file before retrying.")
    const result = parseSopInterpretation(JSON.parse(outputs.filter(item => item.type === "output_text").map(item => item.text ?? "").join("")), originalText)
    if (asset.content_type.includes("officedocument")) result.warnings.push("Office-file interpretation may omit embedded images, charts or layout. Upload a PDF or the original images when those carry instructions.")
    if (!originalText) result.warnings.push("Page references and quotes are AI-generated and require checking against the original asset.")
    return { result, sourceHash, inputTokens: body.usage?.input_tokens ?? null, outputTokens: body.usage?.output_tokens ?? null }
}
