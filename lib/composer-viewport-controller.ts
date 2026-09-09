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
    writeBottom: (bottom: number, animate: boolean) => void
    animateKeyboard: () => boolean
    schedule: (callback: () => void, delay: number) => number
    cancel: (timer: number) => void
    diagnose?: (sample: ComposerViewportDiagnostic) => void
}

// Focus is the user's current intent; viewport samples describe the keyboard.
// Neither a cached keyboard height nor a closing timer may manufacture a reopen.
export function createComposerViewportController(options: Options) {
    const valid = (bottom: number): boolean => Number.isFinite(bottom) && bottom > 0
    const initial = options.readBottom()
    const fallback = options.readLayoutBottom?.() ?? NaN
    let restingBottom: number | null = valid(initial) ? initial : valid(fallback) ? fallback : null
    let layoutBottom = fallback
    let keyboardBottom: number | null = null
    let requestedBottom: number | null = null
    let focused = false
    let mode: "idle" | "pending" | "continuous" | "synthetic" | "settled" | "closing" | "suspended" = "idle"
    let syntheticKeyboard = false
    let continuousClose = false
    let settleTimer = 0
    let reconcileTimer = 0
    let sampleRevision = 0
    let revision = 0
    let disposed = false

    function diagnose(event: ComposerViewportDiagnostic["event"], measured = options.readBottom()) {
        options.diagnose?.({ event, measured, requested: requestedBottom, focused })
    }

    function write(bottom: number, animate: boolean, force = false) {
        if (!valid(bottom)) return
        if (!force && bottom === requestedBottom) return
        requestedBottom = bottom
        options.writeBottom(bottom, animate)
    }
    function cancelScheduled() {
        revision++
        if (settleTimer) options.cancel(settleTimer)
        settleTimer = 0
        cancelReconcile()
    }
    function cancelReconcile() {
        sampleRevision++
        if (reconcileTimer) options.cancel(reconcileTimer)
        reconcileTimer = 0
    }
    function reconcile(bottom: number) {
        if (!valid(bottom)) { diagnose("invalid-sample", bottom); return }
        const layout = options.readLayoutBottom?.() ?? NaN
        // Rotation or window resizing can change the resting edge while an
        // editor stays focused. Never learn a keyboard sample as that edge.
        if (valid(layout) && layout !== layoutBottom) restingBottom = layout
        layoutBottom = layout
        restingBottom ??= bottom
        if (focused) {
            keyboardBottom = bottom < restingBottom - 1 ? bottom : null
            mode = keyboardBottom === null ? "pending" : "settled"
        } else {
            if (mode === "closing" && bottom < restingBottom - 1 && !(valid(layout) && Math.abs(bottom - layout) <= 1)) return
            mode = "idle"
            restingBottom = bottom
            keyboardBottom = null
        }
        if (bottom !== requestedBottom) diagnose("settled", bottom)
        write(bottom, false)
    }
    function queueReconcile() {
        cancelReconcile()
        const expectedRevision = revision, expectedSample = sampleRevision
        const sampled = options.readBottom()
        const current = () => !disposed && mode !== "suspended" && revision === expectedRevision && sampleRevision === expectedSample
        reconcileTimer = options.schedule(() => {
            if (!current()) return
            reconcileTimer = 0
            const bottom = options.readBottom()
            if (valid(bottom) && bottom === sampled) { reconcile(bottom); return }
            // Some resize events precede their metrics. Make one final,
            // bounded confirmation; do not run a permanent polling loop.
            reconcileTimer = options.schedule(() => {
                if (!current()) return
                reconcileTimer = 0
                const confirmed = options.readBottom()
                if (valid(confirmed) && confirmed === bottom) reconcile(confirmed)
                else diagnose(valid(confirmed) ? "unstable-sample" : "invalid-sample", confirmed)
            }, VIEWPORT_CONFIRM_MS)
        }, VIEWPORT_SETTLE_MS)
    }
    function update() {
        if (disposed || mode === "suspended") return
        const bottom = options.readBottom()
        queueReconcile()
        if (!valid(bottom)) { diagnose("invalid-sample", bottom); return }
        restingBottom ??= bottom
        if (!focused) {
            if (mode === "closing" && bottom < restingBottom - 1) {
                // Synthetic closes already have their resting endpoint. Ignore
                // late opening/closing samples instead of learning a half-open
                // keyboard as the next resting height.
                if (continuousClose) write(bottom, false)
                return
            }
            mode = "idle"
            restingBottom = bottom
            keyboardBottom = null
            write(bottom, false)
            return
        }
        const shift = restingBottom - bottom
        if (mode === "settled") {
            keyboardBottom = shift > 1 ? bottom : null
            if (keyboardBottom === null) mode = "pending"
            write(bottom, false)
            return
        }
        // A trailing full-height sample from the previous close must not undo
        // a new focus or move the composer before the keyboard actually opens.
        if (shift <= 1) return
        if (mode === "pending") {
            mode = options.animateKeyboard() && shift >= MINIMUM_KEYBOARD_SHIFT_PX ? "synthetic" : "continuous"
            syntheticKeyboard = mode === "synthetic"
        }
        keyboardBottom = mode === "synthetic" ? Math.min(keyboardBottom ?? bottom, bottom) : bottom
        write(keyboardBottom, mode === "synthetic")
    }
    function focus() {
        if (disposed || focused) return
        cancelScheduled()
        focused = true
        mode = "pending"
        keyboardBottom = null
        diagnose("focus")
        // Keep the known resting edge across interruptions. A fresh viewport
        // sample can reverse motion immediately; an old endpoint cannot.
        update()
    }
    function blur() {
        if (disposed || !focused) return
        cancelScheduled()
        focused = false
        continuousClose = mode === "continuous" || (mode === "settled" && !syntheticKeyboard)
        mode = "closing"
        keyboardBottom = null
        diagnose("blur")
        const bottom = options.readBottom()
        if (restingBottom !== null) write(continuousClose && valid(bottom) ? bottom : restingBottom, !continuousClose && options.animateKeyboard())
        const expectedRevision = revision
        settleTimer = options.schedule(() => {
            if (disposed || revision !== expectedRevision || focused || mode !== "closing") return
            settleTimer = 0
            // Keep the closing guard until a full/stable viewport returns.
            // This callback itself never writes a late endpoint.
            queueReconcile()
        }, VIEWPORT_SETTLE_MS)
        // This is not an input cooldown: focus interrupts it immediately.
    }
    function suspend() {
        if (disposed) return
        cancelScheduled()
        focused = false
        mode = "suspended"
        continuousClose = false
        keyboardBottom = null
        diagnose("suspend")
        if (restingBottom !== null) write(restingBottom, false, true)
    }
    function resume() {
        if (disposed || mode !== "suspended") return
        cancelScheduled()
        const expectedRevision = revision
        diagnose("resume")
        if (restingBottom !== null) write(restingBottom, false, true)
        settleTimer = options.schedule(() => {
            if (disposed || revision !== expectedRevision || focused || mode !== "suspended") return
            settleTimer = 0
            mode = "closing"
            update()
        }, VIEWPORT_SETTLE_MS)
    }
    function dispose() {
        if (disposed) return
        cancelScheduled()
        disposed = true
        if (restingBottom !== null) write(restingBottom, false, true)
    }
    update()
    return { update, focus, blur, suspend, resume, dispose }
}
