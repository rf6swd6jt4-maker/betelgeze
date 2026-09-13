import { sopCost, sopRate, sopUsage } from "./pricing"
import type { SopRate, SopTokenUsage } from "./pricing"
export type MeterStart = { model: string; rate: SopRate | null }
export type MeterFinish = { status: "received" | "unknown"; response_id: string | null; usage: SopTokenUsage | null; estimated_usd: number | null; model: string; rate: SopRate | null }
export function meteredSopRequest(model: string, meter: { start: (v: MeterStart) => Promise<void>; finish: (v: MeterFinish) => Promise<void> }, request: typeof fetch = fetch): typeof fetch {
    return async (url, init) => {
        const rate = sopRate(model)
        await meter.start({ model, rate }) // No paid dispatch unless the ledger is durable.
        let response: Response
        try { response = await request(url, init) }
        catch {
            await meter.finish({ status: "unknown", response_id: null, usage: null, estimated_usd: null, model, rate })
            throw new Error("OpenAI request was interrupted. Its cost is unknown; retry only explicitly.")
        }
        const body = await response.clone().json().catch(() => null) as { id?: string; model?: string; service_tier?: string; usage?: unknown } | null
        const resolvedModel = body?.model ?? model, resolvedRate = sopRate(resolvedModel)
        const usage = sopUsage(body?.usage)
        // Rates cover standard processing only, never guess unknown model/tier prices.
        const pricedRate = !body?.service_tier || body.service_tier === "default" ? resolvedRate : null
        await meter.finish({ status: "received", response_id: typeof body?.id === "string" ? body.id.slice(0, 200) : null, usage, estimated_usd: sopCost(usage, pricedRate), model: resolvedModel, rate: pricedRate })
        return response // Usage survives refusal, truncation, invalid JSON or validation failure.
    }
}
