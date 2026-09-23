export const COMPOSER_KEYBOARD_MOTION_MS = 300
const MINIMUM_KEYBOARD_SHIFT_PX = 64
const VIEWPORT_SETTLE_MS = COMPOSER_KEYBOARD_MOTION_MS + 340
const VIEWPORT_CONFIRM_MS = 80

export type ComposerViewportDiagnostic = {
    event: "invalid-sample" | "settled" | "unstable-sample" | "focus" | "blur" | "suspend" | "resume"
    measured: number
    requested: number | null
    focused: boolean
}

type Options = {
    readBottom: () => number
    readLayoutBottom?: () => number
    readAppliedBottom?: () => number
    writeBottom: (bottom: number, animate: boolean) => void
    animateKeyboard: () => boolean
    schedule: (callback: () => void, delay: number) => number
    cancel: (timer: number) => void
    diagnose?: (sample: ComposerViewportDiagnostic) => void
}

// The visual viewport supplies geometry. Focus and blur only determine whether
// its first substantial movement may use the keyboard motion animation.
export function createComposerViewportController(options: Options) {
    const valid = (bottom: number): boolean => Number.isFinite(bottom) && bottom > 0
    const initial = options.readBottom()
    const layout = options.readLayoutBottom?.() ?? NaN
    let restingBottom: number | null = valid(layout) ? layout : valid(initial) ? initial : null
    let requestedBottom: number | null = null
    let focused = false
    let phase: "idle" | "opening" | "closing" | "suspended" = "idle"
    let motionStarted = false
    let settleTimer = 0
    let reconcileTimer = 0
    let revision = 0
    let disposed = false

    function diagnose(event: ComposerViewportDiagnostic["event"], measured = options.readBottom()) {
        options.diagnose?.({ event, measured, requested: requestedBottom, focused })
    }

    function cancelScheduled() {
        revision++
        if (settleTimer) options.cancel(settleTimer)
        if (reconcileTimer) options.cancel(reconcileTimer)
        settleTimer = 0
        reconcileTimer = 0
    }

    function accept(bottom: number, allowAnimation: boolean) {
        if (!valid(bottom)) { diagnose("invalid-sample", bottom); return }
        const currentLayout = options.readLayoutBottom?.() ?? NaN
        if (valid(currentLayout)) restingBottom = currentLayout
        else if (restingBottom === null || (!focused && bottom >= restingBottom - 1)) restingBottom = bottom

        if (bottom === requestedBottom) {
            // A retired/interrupted compositor animation may leave the real
            // layout at its former edge. Repair it from this fresh measurement;
            // the motion owner ignores duplicate targets still in flight.
            const applied = options.readAppliedBottom?.()
            if (applied !== undefined && valid(applied) && applied !== bottom) {
                options.writeBottom(bottom, false)
            }
            return
        }
        const previous = requestedBottom
        const expectedDirection = phase === "opening" ? -1 : phase === "closing" ? 1 : 0
        const change = previous === null ? 0 : (bottom - previous) * expectedDirection
        const animate = allowAnimation && !motionStarted && expectedDirection !== 0 &&
            change >= MINIMUM_KEYBOARD_SHIFT_PX &&
            (phase !== "opening" || (restingBottom !== null && bottom < restingBottom - 1)) &&
            options.animateKeyboard()
        if (expectedDirection !== 0) motionStarted = true
        requestedBottom = bottom
        options.writeBottom(bottom, animate)
    }

    function queueReconcile(sampled: number) {
        cancelScheduled()
        const expectedRevision = revision
        const current = () => !disposed && phase !== "suspended" && revision === expectedRevision
        settleTimer = options.schedule(() => {
            if (!current()) return
            settleTimer = 0
            const bottom = options.readBottom()
            if (valid(bottom) && bottom === sampled) {
                if (bottom !== requestedBottom) diagnose("settled", bottom)
                accept(bottom, false)
                return
            }
            // An event can precede its visual-viewport metrics. Confirm once,
            // using the latest measurement rather than replaying the event's
            // old endpoint. No background polling survives this confirmation.
            reconcileTimer = options.schedule(() => {
                if (!current()) return
                reconcileTimer = 0
                const confirmed = options.readBottom()
                if (valid(confirmed)) {
                    if (confirmed !== bottom) diagnose("unstable-sample", confirmed)
                    else if (confirmed !== requestedBottom) diagnose("settled", confirmed)
                    accept(confirmed, false)
                } else diagnose("invalid-sample", confirmed)
            }, VIEWPORT_CONFIRM_MS)
        }, VIEWPORT_SETTLE_MS)
    }

    function update() {
        if (disposed || phase === "suspended") return
        const bottom = options.readBottom()
        accept(bottom, true)
        queueReconcile(bottom)
    }

    function focus() {
        if (disposed || focused) return
        cancelScheduled()
        focused = true
        phase = "opening"
        motionStarted = false
        diagnose("focus")
        update()
    }

    function blur() {
        if (disposed || !focused) return
        cancelScheduled()
        focused = false
        phase = "closing"
        motionStarted = false
        diagnose("blur")
        update()
    }

    function suspend() {
        if (disposed) return
        cancelScheduled()
        focused = false
        phase = "suspended"
        motionStarted = false
        diagnose("suspend")
    }

    function resume() {
        if (disposed || phase !== "suspended") return
        cancelScheduled()
        phase = "idle"
        diagnose("resume")
        update()
    }

    function dispose() {
        if (disposed) return
        cancelScheduled()
        disposed = true
    }

    update()
    return { update, focus, blur, suspend, resume, dispose }
}
