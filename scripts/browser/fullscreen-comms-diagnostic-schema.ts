export const DIAGNOSTIC_BUILD = "comms-edges-v7"
export const DIAGNOSTIC_ROLES = ["html", "body", "shell", "topbar", "tabs", "panel", "list", "surface", "chat", "header", "pinned", "motionClip", "motionLayer", "messagePane", "messageStack", "firstMessage", "lastMessage", "composerSlot", "footer", "accessories", "form", "editor", "editorScroller", "sendButton"]
export const DIAGNOSTIC_EVENTS = ["start", "stop", "pointerdown", "pointerup", "pointercancel", "touchstart", "touchmove", "touchend", "touchcancel", "focusin", "focusout", "beforeinput", "input", "compositionstart", "compositionend", "selectionchange", "scroll", "scrollend", "transitionrun", "transitionend", "animationstart", "animationend", "conversation-layout-will-change", "conversation-layout-commit", "viewport-resize", "viewport-scroll", "viewport-scrollend", "window-resize", "window-scroll", "window-scrollend", "ownership", "resize-observer", "mutation-observer", "visibility", "pagehide", "nodes-changed"]
export const DIAGNOSTIC_LIMITS = { frames: 3000, events: 6000, styles: 6000, duration: 45000, bytes: 12 * 1024 * 1024 }
export type DiagnosticState = "ready" | "recording" | "saving" | "saved" | "error"
export type DiagnosticFrame = { t: number; cost: number; viewport: number[]; phase: number; focus: number; selection: number[]; nodes: number[][] }
export type DiagnosticTrace = { build: string; run: number; elapsed: number; device: "touch" | "desktop"; reason: string; frames: DiagnosticFrame[]; events: number[][]; styles: number[][] }

// Numbers and fixed enums only: no text, DOM ids, CSS classes or URLs.
export function sanitizeDiagnosticTrace(input: unknown): DiagnosticTrace | null {
    if (!input || typeof input !== "object") return null
    const value = input as Record<string, unknown>
    const number = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x) && Math.abs(x) <= 1e15
    const vector = (x: unknown, length: number): x is number[] => Array.isArray(x) && x.length === length && x.every(number)
    if (value.build !== DIAGNOSTIC_BUILD || !number(value.run) || !number(value.elapsed) || value.elapsed < 0 || value.elapsed > 120000 || !["touch", "desktop"].includes(String(value.device)) || !["manual", "timeout", "hidden", "pagehide", "limit"].includes(String(value.reason))) return null
    if (!Array.isArray(value.frames) || !value.frames.length || value.frames.length > DIAGNOSTIC_LIMITS.frames || !Array.isArray(value.events) || value.events.length > DIAGNOSTIC_LIMITS.events || !Array.isArray(value.styles) || value.styles.length > DIAGNOSTIC_LIMITS.styles) return null
    const frames: DiagnosticFrame[] = []
    for (const raw of value.frames) {
        if (!raw || typeof raw !== "object") return null
        const f = raw as Record<string, unknown>
        if (!number(f.t) || !number(f.cost) || !number(f.phase) || f.phase < 0 || f.phase > 4 || !number(f.focus) || !vector(f.viewport, 13) || !vector(f.selection, 7) || !Array.isArray(f.nodes) || f.nodes.length > DIAGNOSTIC_ROLES.length) return null
        if (!f.nodes.every(row => vector(row, 13) && Number.isInteger(row[0]) && row[0] >= 0 && row[0] < DIAGNOSTIC_ROLES.length)) return null
        frames.push({ t: f.t, cost: f.cost, viewport: [...f.viewport], phase: f.phase, focus: f.focus, selection: [...f.selection], nodes: f.nodes.map(row => [...row]) })
    }
    if (!value.events.every(row => vector(row, 10) && Number.isInteger(row[1]) && row[1] >= 0 && row[1] < DIAGNOSTIC_EVENTS.length)) return null
    if (!value.styles.every(row => vector(row, 27) && Number.isInteger(row[1]) && row[1] >= 0 && row[1] < DIAGNOSTIC_ROLES.length)) return null
    return { build: DIAGNOSTIC_BUILD, run: value.run, elapsed: value.elapsed, device: value.device as "touch" | "desktop", reason: String(value.reason), frames, events: value.events.map(row => [...row]), styles: value.styles.map(row => [...row]) }
}
