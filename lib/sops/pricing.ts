export type SopTokenUsage = { input: number; cached: number; output: number; reasoning: number }
export type SopRate = { input: number; cached: number; output: number; currency: "USD"; checked: string; source: string }
export function sopRate(model: string): SopRate | null {
    if (!["gpt-5.4-mini", "gpt-5.4-mini-2026-03-17"].includes(model)) return null
    return { input: 0.75, cached: 0.075, output: 4.5, currency: "USD", checked: "2026-09-13", source: "https://developers.openai.com/api/docs/models/gpt-5.4-mini" }
}
export function sopUsage(value: unknown): SopTokenUsage | null {
    const u = value as { input_tokens?: number; output_tokens?: number; input_tokens_details?: { cached_tokens?: number }; output_tokens_details?: { reasoning_tokens?: number } } | null
    if (!u) return null
    const input = u.input_tokens, output = u.output_tokens, cached = u.input_tokens_details?.cached_tokens ?? 0, reasoning = u.output_tokens_details?.reasoning_tokens ?? 0
    if (![input, output, cached, reasoning].every(n => Number.isSafeInteger(n) && n! >= 0) || cached > input! || reasoning > output!) return null
    return { input: input!, cached, output: output!, reasoning }
}
export function sopCost(usage: SopTokenUsage | null, rate: SopRate | null): number | null {
    if (!usage || !rate) return null
    // Reasoning tokens are already included in output. Do not count them twice.
    return ((usage.input - usage.cached) * rate.input + usage.cached * rate.cached + usage.output * rate.output) / 1_000_000
}
export type SopUsageEntry = { id: string; stage: "interpretation" | "generation"; run_id: string | null; model: string; status: string; usage: SopTokenUsage | null; estimated_usd: number | null; rate: SopRate | null; created_at: string }
export function sopCostReport(entries: SopUsageEntry[], runId: string) {
    const summarize = (rows: SopUsageEntry[]) => ({ calls: rows.length, knownUsd: rows.reduce((sum, row) => sum + (row.estimated_usd ?? 0), 0), unknownCalls: rows.filter(row => row.estimated_usd === null).length })
    return { thisRun: summarize(entries.filter(row => row.run_id === runId)), sourceHistory: summarize(entries.filter(row => row.stage === "interpretation")), generation: summarize(entries.filter(row => row.run_id === runId && row.stage === "generation")) }
}
