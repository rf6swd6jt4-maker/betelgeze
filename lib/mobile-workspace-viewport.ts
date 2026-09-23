type Options = {
    view: Window
    root: HTMLElement
    topbar: HTMLElement
    tabbar: HTMLElement
    panel: HTMLElement
    active: () => boolean
}

export type MobileWorkspaceBounds = { top: number; height: number }

/** Both values are in layout-viewport CSS pixels. Never add top to height. */
export function mobileWorkspaceBounds(view: Pick<Window, "visualViewport" | "innerHeight">): MobileWorkspaceBounds | null {
    const viewport = view.visualViewport
    const top = viewport?.offsetTop ?? 0
    const height = viewport?.height ?? view.innerHeight
    const scale = viewport?.scale ?? 1
    if (![top, height, scale].every(Number.isFinite) || top < 0 || height <= 0 || Math.abs(scale - 1) >= 0.01) return null
    return { top, height }
}

/** One geometry owner for a same-document mobile conversation and its chrome.
 * Focus never predicts geometry; each update reads the browser's current bounds.
 * No transforms, animation endpoints, document scrolling or settling timers.
 */
export function observeMobileWorkspaceViewport({ view, root, topbar, tabbar, panel, active }: Options) {
    let disposed = false
    let suspended = false
    let owned = false
    let frame = 0
    let previous = ""
    const properties = ["--mobile-workspace-top", "--mobile-workspace-height", "--mobile-workspace-header-height", "--mobile-workspace-tabs-height"]

    function release() {
        if (frame) view.cancelAnimationFrame(frame)
        frame = 0
        if (!owned) return
        owned = false
        previous = ""
        delete root.dataset.mobileCommsViewport
        properties.forEach(property => root.style.removeProperty(property))
    }

    function measure() {
        if (disposed || suspended) return false
        if (!active()) { release(); return false }
        const bounds = mobileWorkspaceBounds(view)
        // Invalid/transient zoom measurements cannot expand a keyboard-open chat.
        if (!bounds) return owned
        const headerHeight = topbar.offsetHeight
        const tabsHeight = tabbar.offsetHeight
        const signature = `${bounds.top}:${bounds.height}:${headerHeight}:${tabsHeight}`
        if (owned && signature === previous) return true
        const panes = [...panel.querySelectorAll<HTMLElement>("[data-message-pane]")].filter(pane => pane.clientHeight > 0)
        panes.forEach(pane => pane.dispatchEvent(new Event("conversation-layout-will-change")))
        const values = [bounds.top, bounds.height, headerHeight, tabsHeight]
        properties.forEach((property, index) => root.style.setProperty(property, `${values[index]}px`))
        root.dataset.mobileCommsViewport = "true"
        owned = true
        previous = signature
        // Preserve the existing scroll/reading owner and its native-touch guard.
        panes.forEach(pane => pane.dispatchEvent(new Event("conversation-layout-commit")))
        return true
    }

    function update() {
        const handled = measure()
        if (frame) view.cancelAnimationFrame(frame)
        frame = 0
        if (handled && !suspended && !disposed) frame = view.requestAnimationFrame(() => { frame = 0; measure() })
        return handled
    }
    function suspend() {
        suspended = true
        if (frame) view.cancelAnimationFrame(frame)
        frame = 0
    }
    function resume() { suspended = false; return update() }
    // Width/font changes may alter chrome height without a viewport event.
    const observer = new ResizeObserver(() => { if (owned) update() })
    observer.observe(topbar)
    observer.observe(tabbar)
    return {
        update, suspend, resume,
        dispose() { disposed = true; observer.disconnect(); release() },
    }
}
