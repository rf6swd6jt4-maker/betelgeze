import type { ComposerViewportDiagnostic } from "./composer-viewport-controller"

export function readChatLayoutBottom(view: Window) {
    return view.document.documentElement.clientHeight || view.innerHeight
}

export function readChatViewportBottom(view: Window) {
    const viewport = view.visualViewport
    if (!viewport) return view.innerHeight
    const { height, offsetTop, scale } = viewport
    // Keep the last usable geometry during invalid samples or native zoom.
    // A visual-viewport offset contributes to its bottom, never a shell transform.
    if (![height, offsetTop, scale].every(Number.isFinite) || height <= 0 || offsetTop < 0 || Math.abs(scale - 1) >= 0.01) return NaN
    const bottom = Math.round(offsetTop + height)
    return bottom <= readChatLayoutBottom(view) + 1 ? bottom : NaN
}

type ViewportDiagnostic = ComposerViewportDiagnostic & {
    at: number
    surface: "workspace" | "portal"
    height: number | null
    offsetTop: number | null
    scale: number | null
    layoutHeight: number
    scrollTop: number
    panelTop: number | null
    panelHeight: number | null
}

type DiagnosticWindow = Window & { __betelgezeChatViewportDiagnostics?: ViewportDiagnostic[] }

// A bounded, in-memory record for Web Inspector. Never includes text, user IDs,
// URLs, or drafts; nothing is persisted or sent to a server.
export function recordChatViewportDiagnostic(view: Window, surface: ViewportDiagnostic["surface"], panel: HTMLElement | null, sample: ComposerViewportDiagnostic) {
    const target = view as DiagnosticWindow
    const entries = target.__betelgezeChatViewportDiagnostics ??= []
    const rect = panel?.getBoundingClientRect()
    entries.push({
        ...sample, at: Date.now(), surface,
        height: view.visualViewport?.height ?? null,
        offsetTop: view.visualViewport?.offsetTop ?? null,
        scale: view.visualViewport?.scale ?? null,
        layoutHeight: readChatLayoutBottom(view),
        scrollTop: view.document.documentElement.scrollTop,
        panelTop: rect?.top ?? null, panelHeight: rect?.height ?? null,
    })
    if (entries.length > 64) entries.splice(0, entries.length - 64)
}
