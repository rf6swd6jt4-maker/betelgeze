export const COMPOSER_KEYBOARD_MOTION_MS = 300
const MINIMUM_KEYBOARD_SHIFT_PX = 64
const VIEWPORT_SETTLE_MS = COMPOSER_KEYBOARD_MOTION_MS + 340

type Options = {
    readBottom: () => number
    writeBottom: (bottom: number, animate: boolean) => void
    animateKeyboard: () => boolean
    schedule: (callback: () => void, delay: number) => number
    cancel: (timer: number) => void
}

// Focus is the user's current intent; viewport samples describe the keyboard.
// Neither a cached keyboard height nor a closing timer may manufacture a reopen.
export function createComposerViewportController(options: Options) {
    let restingBottom = options.readBottom()
    let keyboardBottom: number | null = null
    let requestedBottom: number | null = null
    let focused = false
    let mode: "idle" | "pending" | "continuous" | "synthetic" | "closing" | "suspended" = "idle"
    let continuousClose = false
    let settleTimer = 0
    let revision = 0
    let disposed = false

    function write(bottom: number, animate: boolean, force = false) {
        if (!force && bottom === requestedBottom) return
        requestedBottom = bottom
        options.writeBottom(bottom, animate)
    }
    function cancelScheduled() {
        revision++
        if (settleTimer) options.cancel(settleTimer)
        settleTimer = 0
    }
    function update() {
        if (disposed || mode === "suspended") return
        const bottom = options.readBottom()
        if (!focused) {
            if (mode === "closing" && bottom < restingBottom - 1) {
                // Synthetic closes already have their resting endpoint. Ignore
                // late opening/closing samples instead of learning a half-open
                // keyboard as the next resting height.
                if (continuousClose) write(bottom, false)
                return
            }
            cancelScheduled()
            mode = "idle"
            restingBottom = bottom
            keyboardBottom = null
            write(bottom, false)
            return
        }
        const shift = restingBottom - bottom
        // A trailing full-height sample from the previous close must not undo
        // a new focus or move the composer before the keyboard actually opens.
        if (shift <= 1) return
        if (mode === "pending") {
            mode = options.animateKeyboard() && shift >= MINIMUM_KEYBOARD_SHIFT_PX ? "synthetic" : "continuous"
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
        // Keep the known resting edge across interruptions. A fresh viewport
        // sample can reverse motion immediately; an old endpoint cannot.
        update()
    }
    function blur() {
        if (disposed || !focused) return
        cancelScheduled()
        focused = false
        continuousClose = mode === "continuous"
        mode = "closing"
        keyboardBottom = null
        write(continuousClose ? options.readBottom() : restingBottom, !continuousClose && options.animateKeyboard())
        const expectedRevision = revision
        settleTimer = options.schedule(() => {
            if (disposed || revision !== expectedRevision || focused || mode !== "closing") return
            settleTimer = 0
            mode = "idle"
            // Retire the close bookkeeping only. Never read a late viewport
            // sample here or write an endpoint over a more recent user action.
        }, VIEWPORT_SETTLE_MS)
        // This is not an input cooldown: focus interrupts it immediately.
    }
    function suspend() {
        if (disposed) return
        cancelScheduled()
        focused = false
        mode = "suspended"
        keyboardBottom = null
        write(restingBottom, false, true)
    }
    function resume() {
        if (disposed || mode !== "suspended") return
        cancelScheduled()
        const expectedRevision = revision
        write(restingBottom, false, true)
        settleTimer = options.schedule(() => {
            if (disposed || revision !== expectedRevision || focused || mode !== "suspended") return
            settleTimer = 0
            mode = "idle"
            update()
        }, VIEWPORT_SETTLE_MS)
    }
    function dispose() {
        if (disposed) return
        cancelScheduled()
        disposed = true
        write(restingBottom, false, true)
    }
    update()
    return { update, focus, blur, suspend, resume, dispose }
}
