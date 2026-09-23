// @ts-expect-error Node's built-in TypeScript runner needs the source extension.
import { WORKSPACE_TAB_MESSAGE_SOURCE } from "./workspace-tabs.ts"

export const WORKSPACE_FRAME_DOCUMENT_ATTRIBUTE = "data-workspace-frame-document"
export const WORKSPACE_FRAME_PAGE_ATTRIBUTE = "data-workspace-frame-page-mounted"
export const WORKSPACE_FRAME_ERROR_ATTRIBUTE = "data-workspace-frame-error"
export const WORKSPACE_FRAME_DEPARTURE_CONFIRM_EVENT = "betelgeze:confirm-frame-departure"
export type WorkspaceFrameDepartureConfirmation = { requestId: string; documentId: string; safe: boolean }

type DepartureFrame = Pick<HTMLIFrameElement, "contentDocument" | "contentWindow">
const confirmations = new WeakMap<DepartureFrame, () => boolean>()

/** Invoke in the task that commits removal, after all asynchronous checks finish. */
export function confirmWorkspaceFrameDeparture(frame: DepartureFrame) {
    const confirm = confirmations.get(frame)
    confirmations.delete(frame)
    return confirm?.() === true
}

/** A bounded local acknowledgement. Missing/stale responses never authorize losing a page. */
export function prepareWorkspaceFrameDeparture(frame: DepartureFrame, tabId: string, host: Window = window, signal?: AbortSignal, checkpointOnly = false): Promise<boolean> {
    confirmations.delete(frame)
    if (signal?.aborted) return Promise.resolve(false)
    let document: Document | null
    let source: Window | null
    try { document = frame.contentDocument; source = frame.contentWindow } catch { return Promise.resolve(false) }
    if (!document || !source) return Promise.resolve(false)
    const root = document.documentElement
    const documentId = root?.getAttribute(WORKSPACE_FRAME_DOCUMENT_ATTRIBUTE)
    if (!documentId) {
        // Initial empty documents and an explicitly mounted error boundary have
        // no live page owner. A formerly usable document never takes this path.
        const neverMounted = !root?.hasAttribute(WORKSPACE_FRAME_PAGE_ATTRIBUTE)
        const safe = neverMounted && (document.URL === "about:blank" || root?.hasAttribute(WORKSPACE_FRAME_ERROR_ATTRIBUTE) === true)
        if (safe) confirmations.set(frame, () => {
            try { return frame.contentDocument === document && frame.contentWindow === source && !root?.hasAttribute(WORKSPACE_FRAME_PAGE_ATTRIBUTE) && !root?.hasAttribute(WORKSPACE_FRAME_DOCUMENT_ATTRIBUTE) && (document.URL === "about:blank" || root?.hasAttribute(WORKSPACE_FRAME_ERROR_ATTRIBUTE) === true) } catch { return false }
        })
        return Promise.resolve(safe)
    }
    const requestId = host.crypto.randomUUID()
    return new Promise((resolve) => {
        let settled = false
        const finish = (safe: boolean) => {
            if (settled) return
            settled = true
            host.clearTimeout(timer)
            host.removeEventListener("message", receive)
            signal?.removeEventListener("abort", abort)
            resolve(safe)
        }
        const abort = () => finish(false)
        const receive = (event: MessageEvent) => {
            const message = event.data
            if (event.origin !== host.location.origin || event.source !== source || message?.source !== WORKSPACE_TAB_MESSAGE_SOURCE || message.target !== "host" || message.type !== "departure-ready" || message.tabId !== tabId || message.requestId !== requestId || message.documentId !== documentId) return
            try {
                const safe = frame.contentWindow === source && frame.contentDocument === document && root.getAttribute(WORKSPACE_FRAME_DOCUMENT_ATTRIBUTE) === documentId && message.safe === true
                if (safe) confirmations.set(frame, () => {
                    try {
                        if (signal?.aborted || frame.contentWindow !== source || frame.contentDocument !== document || root.getAttribute(WORKSPACE_FRAME_DOCUMENT_ATTRIBUTE) !== documentId) return false
                        const detail: WorkspaceFrameDepartureConfirmation = { requestId, documentId, safe: false }
                        source.dispatchEvent(new CustomEvent(WORKSPACE_FRAME_DEPARTURE_CONFIRM_EVENT, { detail }))
                        return detail.safe
                    } catch { return false }
                })
                finish(safe)
            } catch { finish(false) }
        }
        const timer = host.setTimeout(() => finish(false), 1_800)
        host.addEventListener("message", receive)
        signal?.addEventListener("abort", abort, { once: true })
        try { source.postMessage({ source: WORKSPACE_TAB_MESSAGE_SOURCE, target: "frame", type: "prepare-departure", tabId, requestId, documentId, checkpointOnly }, host.location.origin) } catch { finish(false) }
    })
}

/** Callers preflight only the owners displaced by this bounded activation. */
export function workspaceResidentEvictions(residents: string[], nextActiveId: string, limit: number, closingId?: string) {
    const retained = residents.filter((id) => id !== closingId)
    return [nextActiveId, ...retained.filter((id) => id !== nextActiveId)].slice(limit)
}
