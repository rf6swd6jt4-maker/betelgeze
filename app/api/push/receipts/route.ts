import { supabaseAdmin } from "@/lib/supabase/admin"
import { UUID_PATTERN } from "@/lib/push/device"
export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export async function POST(request: Request) {
    const reader = request.body?.getReader()
    if (!reader) return new Response(null, { status: 400 })
    let raw = ""
    let size = 0
    const decoder = new TextDecoder()
    try {
        while (true) {
            const { done, value } = await reader.read()
            if (done) break
            size += value.byteLength
            if (size > 400) { await reader.cancel(); return new Response(null, { status: 413 }) }
            raw += decoder.decode(value, { stream: true })
        }
        raw += decoder.decode()
    } catch { return new Response(null, { status: 400 }) }
    let input: { deliveryId?: unknown; receiptToken?: unknown; outcome?: unknown }
    try { input = JSON.parse(raw) } catch { return new Response(null, { status: 400 }) }
    if (!input || typeof input.deliveryId !== "string" || !UUID_PATTERN.test(input.deliveryId) || typeof input.receiptToken !== "string" || !UUID_PATTERN.test(input.receiptToken) || !["shown", "failed"].includes(String(input.outcome))) return new Response(null, { status: 400 })
    const result = await supabaseAdmin.rpc("record_chat_push_receipt", { p_id: input.deliveryId, p_token: input.receiptToken, p_outcome: input.outcome })
    return new Response(null, { status: result.error ? 503 : 204, headers: { "Cache-Control": "no-store" } })
}
