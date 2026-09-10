type NavigationClock = {
    isForeground: () => boolean
    now: () => number
    schedule: (callback: () => void, delay: number) => number
    cancel: (timer: number) => void
}

/** A UI failure deadline, deliberately separate from elapsed-time telemetry. */
export function createWorkspaceNavigationDeadline(onTimeout: () => void, clock: NavigationClock, budgetMs = 12_000) {
    let remaining = budgetMs
    let startedAt: number | null = null
    let timer: number | null = null
    let generation = 0
    let stopped = false

    const pause = () => {
        generation += 1
        if (timer !== null) clock.cancel(timer)
        timer = null
        if (startedAt !== null) remaining = Math.max(0, remaining - Math.max(0, clock.now() - startedAt))
        startedAt = null
    }
    const update = () => {
        if (stopped) return
        pause()
        if (!clock.isForeground()) return
        if (remaining <= 0) {
            stopped = true
            onTimeout()
            return
        }
        startedAt = clock.now()
        const scheduledGeneration = generation
        timer = clock.schedule(() => {
            // A cancelled timer may already be queued when a route changes.
            if (!stopped && generation === scheduledGeneration) update()
        }, remaining)
    }
    update()
    return { update, cancel: () => { stopped = true; pause() } }
}

/** Native readiness describes only the currently requested route, including its query. */
export function workspaceNavigationReadyMatches(url: string, currentUrl: string | undefined, pendingUrl?: string, failedUrl?: string) {
    return url === currentUrl && (!pendingUrl || url === pendingUrl) && (!failedUrl || url === failedUrl)
}

type PaintEnvironment = {
    visible: () => boolean
    requestFrame: (callback: () => void) => number
    cancelFrame: (frame: number) => void
    subscribe: (callback: () => void) => () => void
}

/** Both frame opportunities must be visible; a hidden commit is not a paint. */
export function afterVisibleWorkspacePaint(onReady: () => void, environment: PaintEnvironment) {
    let frame: number | null = null
    let generation = 0
    let stopped = false
    const cancelFrame = () => {
        generation += 1
        if (frame !== null) environment.cancelFrame(frame)
        frame = null
    }
    const update = () => {
        cancelFrame()
        if (stopped || !environment.visible()) return
        const scheduledGeneration = generation
        frame = environment.requestFrame(() => {
            if (stopped || generation !== scheduledGeneration || !environment.visible()) return
            frame = environment.requestFrame(() => {
                if (stopped || generation !== scheduledGeneration || !environment.visible()) return
                frame = null
                stopped = true
                onReady()
            })
        })
    }
    const unsubscribe = environment.subscribe(update)
    update()
    return () => { stopped = true; cancelFrame(); unsubscribe() }
}
