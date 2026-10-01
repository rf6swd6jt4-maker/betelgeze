import { workspaceDocumentIsActive } from "@/lib/workspace-tab-activity"
import { WORKSPACE_TAB_VISIBILITY_EVENT } from "@/lib/workspace-tabs"

type PortalOwnerLifecycle = {
    /** Release presentation effects synchronously; the source may be destroyed. */
    suspend: (event: { persisted: boolean }) => void
    /** Only retained presentations opt into restoration of their existing DOM. */
    resume?: () => void
}

/** A portal in the shell must not outlive the iframe document that created it. */
export function bindPortalOwnerLifetime(node: HTMLElement, lifecycle: PortalOwnerLifecycle) {
    let departed = false
    let disposed = false
    let suspended = false
    let restored = false
    const wasHidden = node.hidden
    const originalDisplay = node.style.display
    const crossDocument = node.ownerDocument !== document

    const detach = () => {
        window.removeEventListener("pagehide", hide)
        window.removeEventListener("pageshow", show)
        window.removeEventListener(WORKSPACE_TAB_VISIBILITY_EVENT, restore)
    }
    const restore = () => {
        if (disposed || !suspended || !restored || !lifecycle.resume || !node.isConnected || !workspaceDocumentIsActive()) return
        suspended = false
        departed = false
        node.hidden = wasHidden
        node.style.display = originalDisplay
        lifecycle.resume()
    }
    const hide = (event: PageTransitionEvent) => {
        if (disposed) return
        departed = true
        suspended = event.persisted
        restored = false
        // React cannot be relied on to commit an unmount while its iframe dies.
        node.hidden = true
        node.style.display = "none"
        lifecycle.suspend({ persisted: event.persisted })
        if (!event.persisted) {
            disposed = true
            detach()
            node.remove()
        }
    }
    const show = (event: PageTransitionEvent) => {
        if (!event.persisted || disposed) return
        restored = true
        restore()
    }
    if (crossDocument) {
        window.addEventListener("pagehide", hide)
        window.addEventListener("pageshow", show)
        if (lifecycle.resume) window.addEventListener(WORKSPACE_TAB_VISIBILITY_EVENT, restore)
    }
    return {
        hasDeparted: () => departed,
        dispose: () => { disposed = true; if (crossDocument) detach() },
    }
}
