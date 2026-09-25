/** Observe changes that can reveal or cover the latest row without a React
 * render or a user gesture. Only the foreground reader installs this observer.
 * It invalidates evidence; the reader still verifies attention, geometry and
 * hit testing after two painted frames before recording an observed position.
 */
export function observeChatReadingVisibility(view: Window, getPane: () => HTMLElement | null, messageId: string, check: () => void, options: { interactions: boolean }) {
    const doc = view.document
    const cleanups: (() => void)[] = []
    let disposed = false
    let pane: HTMLElement | null = null
    let row: HTMLElement | null = null
    let ancestors: Element[] = []
    const documents = new Set<Document>([doc])
    try { if (view.top) documents.add(view.top.document) } catch { /* An inaccessible host cannot provide reading evidence. */ }
    const listen = (target: EventTarget, name: string, capture = false) => {
        target.addEventListener(name, changed, { capture, passive: true })
        cleanups.push(() => target.removeEventListener(name, changed, capture))
    }
    const resize = new ResizeObserver(() => { if (!disposed) check() })
    const mutations = new MutationObserver(changed)
    function bind() {
        const candidate = getPane()
        const nextPane = candidate?.isConnected ? candidate : null
        const nextRow = nextPane?.querySelector<HTMLElement>(`[data-message-interaction="${CSS.escape(messageId)}"]`) ?? null
        const nextAncestors: Element[] = []
        for (let element: Element | null = nextRow ?? nextPane; element; element = element.parentElement) nextAncestors.push(element)
        try {
            for (let element = view.frameElement; element; element = element.parentElement) nextAncestors.push(element)
        } catch { /* The predicate independently rejects an inaccessible host. */ }
        if (pane === nextPane && row === nextRow && ancestors.length === nextAncestors.length
            && ancestors.every((element, index) => element === nextAncestors[index])) return
        if (pane !== nextPane) {
            pane?.removeEventListener("scroll", changed)
            pane?.removeEventListener("conversation-layout-commit", changed)
            pane?.removeEventListener("conversation-visible", changed)
            nextPane?.addEventListener("scroll", changed, { passive: true })
            nextPane?.addEventListener("conversation-layout-commit", changed)
            nextPane?.addEventListener("conversation-visible", changed)
        }
        pane = nextPane
        row = nextRow
        ancestors = nextAncestors
        resize.disconnect()
        mutations.disconnect()
        if (pane) resize.observe(pane)
        if (row) resize.observe(row)
        for (const element of ancestors) mutations.observe(element, {
            attributes: true,
            attributeFilter: ["class", "style", "hidden", "inert", "aria-hidden", "data-phase", "data-positioned", "data-chat-viewport-moving", "data-workspace-active-tab-id", "data-workspace-tab-active"],
            childList: true,
        })
        // Portals can attach after the reader's layout effect. Discover the pane
        // only until it exists; normal operation observes its ancestor chain,
        // its local message content, and direct body portals, not the whole app.
        if (!pane || !row) mutations.observe(pane ?? doc.body, { childList: true, subtree: true })
        for (const document of documents) if (document.body && !ancestors.includes(document.body) && (document !== doc || pane)) {
            mutations.observe(document.body, { childList: true })
        }
    }
    function changed() {
        if (disposed) return
        bind()
        check()
    }
    for (const document of documents) {
        if (options.interactions) {
            listen(document, "pointerup")
            listen(document, "keyup")
        }
        listen(document, "transitionend", true)
        listen(document, "animationend", true)
    }
    listen(view, "resize")
    listen(view, "scroll")
    listen(view, "scrollend")
    listen(view, "pageshow")
    if (view.visualViewport) {
        listen(view.visualViewport, "resize")
        listen(view.visualViewport, "scroll")
        listen(view.visualViewport, "scrollend")
    }
    // Ensure discovery also works when both the initial and stored pane are null.
    mutations.observe(doc.body, { childList: true, subtree: true })
    bind()
    check()
    return () => {
        disposed = true
        resize.disconnect()
        mutations.disconnect()
        pane?.removeEventListener("scroll", changed)
        pane?.removeEventListener("conversation-layout-commit", changed)
        pane?.removeEventListener("conversation-visible", changed)
        cleanups.forEach(cleanup => cleanup())
    }
}
