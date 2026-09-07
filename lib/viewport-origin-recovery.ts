type Options = {
    canRestore: () => boolean
    restore: () => void
    requestFrame: (callback: () => void) => number
    cancelFrame: (frame: number) => void
}

// WebKit can retain a document scroll after dismissing the keyboard. Repair
// that only at rest: writing scrollTop during its native focus scroll can
// displace the entire fixed shell before it springs back into place.
export function createViewportOriginRecovery(options: Options) {
    let focused = false
    let suspended = false
    let disposed = false
    let frame = 0
    let revision = 0

    function cancel() {
        revision++
        if (frame) options.cancelFrame(frame)
        frame = 0
    }
    function update() {
        cancel()
        if (disposed || focused || suspended) return
        const expectedRevision = revision
        // Resize events can precede the updated visual viewport metrics on
        // iOS. Observe a resting viewport across two frames, without polling.
        frame = options.requestFrame(() => {
            if (revision !== expectedRevision) return
            frame = 0
            if (!options.canRestore()) return
            frame = options.requestFrame(() => {
                if (revision !== expectedRevision) return
                frame = 0
                if (options.canRestore()) options.restore()
            })
        })
    }
    function focus() { cancel(); focused = true }
    function blur() { focused = false; update() }
    function suspend() { cancel(); focused = false; suspended = true }
    function resume() { suspended = false; update() }
    function dispose() { cancel(); disposed = true }

    return { update, focus, blur, suspend, resume, dispose }
}
