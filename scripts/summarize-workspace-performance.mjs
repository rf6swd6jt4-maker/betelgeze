import { readFileSync } from "node:fs"

export function nearestRank(values, percentile) {
    if (!values.length) return null
    const sorted = [...values].sort((a, b) => a - b)
    return sorted[Math.max(0, Math.ceil(percentile * sorted.length) - 1)]
}

export function summarize(samples) {
    const groups = new Map()
    let malformed = 0
    for (const raw of samples) {
        const sample = raw.measurement ?? raw
        if (!sample || !Number.isFinite(sample.durationMs) || sample.durationMs < 0 || typeof sample.operation !== "string") { malformed++; continue }
        const context = {
            operation: sample.operation, command: sample.command ?? "unknown", routeSection: sample.routeSection,
            cacheState: sample.cacheState, renderer: sample.renderer, background: sample.background,
            foregroundThroughout: sample.startedVisible && sample.endedVisible && sample.visibilityChanges === 0,
            suspended: sample.suspended, deployment: raw.deployment_sha ?? raw.deployment ?? "unlabelled",
        }
        const key = JSON.stringify(context)
        if (!groups.has(key)) groups.set(key, { context, samples: [] })
        groups.get(key).samples.push(sample)
    }
    return {
        total: samples.length, malformed,
        groups: [...groups.values()].map(({ context, samples: group }) => {
            const outcomes = Object.fromEntries(["completed", "failed", "aborted", "timeout"].map((outcome) => [outcome, group.filter((sample) => sample.outcome === outcome).length]))
            const boundaries = {}
            for (const boundary of ["code_ready", "data_ready", "meaningful_ready", "local_persisted", "server_ack", "external_completed", "visual_response"]) {
                const values = group.flatMap((sample) => Number.isFinite(sample.boundaries?.[boundary]) ? [sample.boundaries[boundary]] : [])
                boundaries[boundary] = { count: values.length, missing: group.length - values.length, p50: nearestRank(values, .5), p95: nearestRank(values, .95) }
            }
            return { ...context, count: group.length, outcomes, boundaries }
        }),
    }
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href) {
    const path = process.argv[2]
    if (!path) throw new Error("Usage: node scripts/summarize-workspace-performance.mjs samples.json[ l ]")
    const text = readFileSync(path, "utf8").trim()
    const input = text.startsWith("[") ? JSON.parse(text) : text.split("\n").filter(Boolean).map((line) => JSON.parse(line))
    process.stdout.write(`${JSON.stringify(summarize(input), null, 2)}\n`)
}
