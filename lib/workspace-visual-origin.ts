// WebKit may pan a locked document while focusing an editor without changing
// document scrollTop. Correct only a measured displacement of the fixed chrome;
// visualViewport.offsetTop can lag behind the actual painted position.
export function createWorkspaceVisualOrigin(options: {
    readTop: () => number
    readLimit: () => number
    writeOffset: (offset: number) => void
    requestFrame: (callback: () => void) => number
    cancelFrame: (frame: number) => void
}) {
    let offset = 0
    let disposed = false
    let suspended = false
    let frame = 0

    function measure() {
        if (disposed || suspended) return
        const limit = options.readLimit()
        if (!Number.isFinite(limit)) return
        const top = limit > 0 ? options.readTop() : NaN
        const next = limit <= 0 ? 0 : Number.isFinite(top)
            ? Math.max(0, Math.min(limit, Math.round(offset - top)))
            : offset
        if (next === offset) return
        offset = next
        options.writeOffset(offset)
    }

    function update() {
        if (disposed || suspended) return
        measure()
        if (frame) options.cancelFrame(frame)
        frame = options.requestFrame(() => {
            frame = 0
            measure()
        })
    }

    function suspend() {
        if (disposed) return
        suspended = true
        if (frame) options.cancelFrame(frame)
        frame = 0
    }

    function resume() {
        if (disposed) return
        suspended = false
        update()
    }

    function dispose() {
        if (disposed) return
        disposed = true
        if (frame) options.cancelFrame(frame)
        frame = 0
        if (offset) options.writeOffset(0)
    }

    return { update, suspend, resume, dispose }
}
