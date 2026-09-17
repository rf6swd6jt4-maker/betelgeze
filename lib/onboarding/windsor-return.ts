// One owner per mounted connection. Return signals coalesce; only an empty
// provider result is retried, and hidden pages never make provider requests.
export function createWindsorReturnMonitor(options: {
    verify: () => Promise<"complete" | "pause" | "retry">
    visible: () => boolean
    settled: () => void
    delays?: number[]
}) {
    let active = false
    let disposed = false
    let running = false
    let queued = false
    let retry = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    const delays = options.delays ?? [1_500, 3_000, 6_000, 10_000]
    async function run() {
        if (disposed || !active || running || timer || !options.visible()) return
        running = true
        queued = false
        let outcome: "complete" | "pause" | "retry" = "pause"
        try { outcome = await options.verify() } finally { running = false }
        if (disposed || !active) return
        if (outcome !== "retry") { active = outcome !== "complete"; options.settled(); return }
        if (queued) { queued = false; retry = 0; void run(); return }
        if (retry < delays.length) {
            timer = setTimeout(() => { timer = undefined; void run() }, delays[retry++])
        } else { options.settled() }
    }
    return {
        start() { active = true; retry = 0 },
        returned() {
            if (!active || disposed) return
            if (running) { queued = true; return }
            // A pending retry already represents this return; don't create a
            // second chain for the focus + visibility + close event cluster.
            if (!timer) { retry = 0; void run() }
        },
        dispose() { disposed = true; active = false; if (timer) clearTimeout(timer) },
    }
}
