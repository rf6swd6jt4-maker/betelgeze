import { MOBILE_CONVERSATION_VISIBILITY_EVENT } from "@/lib/mobile-conversation-viewport"
import { DIAGNOSTIC_BUILD, DIAGNOSTIC_EVENTS, DIAGNOSTIC_LIMITS, type DiagnosticState, type DiagnosticTrace } from "./fullscreen-comms-diagnostic-schema"

/** Local-only explicit capture. No observer changes focus, selection, scroll,
 * layout or application events. No idle polling; numeric geometry only. */
export function installPreviewLayoutTrace(onState: (state: DiagnosticState) => void) {
    let trace: DiagnosticTrace | null = null
    let recording = false, disposed = false, frame = 0, timer = 0, started = 0, lastFrame = -Infinity, lastStyles = -Infinity
    let refreshNodes = true, dirtyStyles = true
    let nodes: Array<HTMLElement | null> = []
    const identities = new WeakMap<Element, number>()
    let identity = 0
    let removers: Array<() => void> = []
    let resizeObserver: ResizeObserver | null = null, mutationObserver: MutationObserver | null = null
    const styles = new Map<number, string>()
    const n = (value: number) => Number.isFinite(value) ? Math.round(value * 100) / 100 : -1
    const now = () => n(performance.now() - started)
    const id = (element: Element) => { if (!identities.has(element)) identities.set(element, ++identity); return identities.get(element)! }
    const role = (target: EventTarget | null) => {
        if (!(target instanceof Node)) return -1
        for (let i = nodes.length - 1; i >= 0; i--) if (nodes[i]?.contains(target)) return i
        return -1
    }
    function event(type: string, target = -1, stage = 0, a = 0, b = 0, c = 0, d = 0) {
        if (!recording || !trace) return
        const index = DIAGNOSTIC_EVENTS.indexOf(type)
        if (index < 0) return
        if (trace.events.length >= DIAGNOSTIC_LIMITS.events) { void stop("limit"); return }
        trace.events.push([now(), index, target, stage, n(a), n(b), n(c), n(d), n(visualViewport?.pageTop ?? scrollY), n(visualViewport?.height ?? innerHeight)])
    }
    function discover() {
        const surface = [...document.querySelectorAll<HTMLElement>("[data-mobile-conversation-surface]")].find(el => !el.hidden) ?? null
        const q = (selector: string) => surface?.querySelector<HTMLElement>(selector) ?? null
        const chat = q("[data-native-chat-viewport]")
        const pane = q("[data-message-pane]")
        const messages = pane?.querySelectorAll<HTMLElement>("[data-message-scroll-anchor]")
        const header = chat?.querySelector<HTMLElement>(":scope > header") ?? null
        const sibling = header?.nextElementSibling as HTMLElement | null
        const pinned = sibling && !sibling.matches("[data-chat-motion-viewport]") ? sibling : null
        const next = [document.documentElement, document.body,
            document.querySelector<HTMLElement>("[data-workspace-shell-root]"), document.querySelector<HTMLElement>("[data-workspace-topbar]"), document.querySelector<HTMLElement>("[data-workspace-tabbar]"), document.querySelector<HTMLElement>("[data-workspace-tab-panels]"),
            [...document.querySelectorAll<HTMLElement>("[data-conversation-list]")].find(el => el.clientHeight > 0) ?? null,
            surface, chat, header, pinned, q("[data-chat-motion-viewport]"), q("[data-chat-motion-layer]"), pane, pane?.firstElementChild as HTMLElement | null,
            messages?.[0] ?? null, messages?.[messages.length - 1] ?? null, q("[data-composer-slot]"), q("footer"), q("[data-composer-accessories]"), q("form"), q(".cm-content"), q(".cm-scroller"), q('button[aria-label="Send message"]')]
        if (next.some((el, i) => el !== nodes[i])) {
            nodes = next; dirtyStyles = true
            resizeObserver?.disconnect()
            nodes.forEach(el => { if (el) resizeObserver?.observe(el) })
            event("nodes-changed", -1, 0, nodes.filter(Boolean).length)
        }
        refreshNodes = false
    }
    function readStyles() {
        if (!trace || !dirtyStyles || performance.now() - lastStyles < 50) return
        lastStyles = performance.now(); dirtyStyles = false
        nodes.forEach((el, index) => {
            if (!el || trace!.styles.length >= DIAGNOSTIC_LIMITS.styles) return
            const css = getComputedStyle(el)
            const num = (key: string) => n(parseFloat(css.getPropertyValue(key)))
            const enumIndex = (value: string, values: string[]) => values.indexOf(value)
            let matrix: DOMMatrixReadOnly | null = null
            try { if (css.transform !== "none") matrix = new DOMMatrixReadOnly(css.transform) } catch { /* Numeric sentinel below. */ }
            const values = [index, id(el), enumIndex(css.position, ["static", "relative", "absolute", "fixed", "sticky"]), enumIndex(css.display, ["none", "block", "flex", "grid", "contents", "inline", "inline-flex", "inline-block"]), enumIndex(css.visibility, ["visible", "hidden", "collapse"]), enumIndex(css.overflowX, ["visible", "hidden", "clip", "auto", "scroll"]), enumIndex(css.overflowY, ["visible", "hidden", "clip", "auto", "scroll"]), num("top"), num("bottom"), num("height"), num("min-height"), num("max-height"), num("padding-top"), num("padding-bottom"), num("font-size"), num("line-height"), n(matrix?.m41 ?? 0), n(matrix?.m42 ?? 0), n(matrix?.m11 ?? 1), n(matrix?.m22 ?? 1), Number(css.contain !== "none"), Number(css.willChange.includes("transform")), num("--conversation-viewport-top"), num("--conversation-viewport-height"), Number(el.hidden), Number(el.inert)]
            const signature = values.join(",")
            if (styles.get(index) !== signature) { styles.set(index, signature); trace!.styles.push([now(), ...values]) }
        })
    }
    function sample() {
        if (!trace) return
        const began = performance.now()
        if (refreshNodes) discover()
        readStyles()
        const vv = visualViewport
        const selection = getSelection()
        let rect: DOMRect | null = null
        try { if (selection?.rangeCount) rect = selection.getRangeAt(0).getBoundingClientRect() } catch { /* A native selection may detach between events. */ }
        const phase = [undefined, "entering", "open", "dismissing-keyboard", "leaving"].indexOf(document.documentElement.dataset.mobileConversationPhase)
        const rows: number[][] = []
        nodes.forEach((el, index) => {
            if (!el) return
            const r = el.getBoundingClientRect()
            rows.push([index, id(el), n(r.x), n(r.y), n(r.width), n(r.height), n(el.scrollTop), n(el.scrollHeight), n(el.clientHeight), n(el.offsetTop), n(el.offsetHeight), Number(el.hidden), Number(el.inert)])
        })
        trace.frames.push({ t: now(), cost: n(performance.now() - began), viewport: [n(vv?.pageTop ?? scrollY), n(vv?.offsetTop ?? 0), n(vv?.height ?? innerHeight), n(vv?.width ?? innerWidth), n(vv?.scale ?? 1), n(scrollY), n(innerHeight), n(innerWidth), document.documentElement.clientHeight, n(document.documentElement.scrollTop), n(document.body.scrollTop), Number(document.hasFocus()), Number(document.visibilityState === "visible")], phase: Math.max(0, phase), focus: role(document.activeElement), selection: [Number(!!selection?.isCollapsed), selection?.rangeCount ?? 0, role(selection?.anchorNode ?? null), n(rect?.x ?? -1), n(rect?.y ?? -1), n(rect?.width ?? -1), n(rect?.height ?? -1)], nodes: rows })
    }
    function tick(time: number) {
        frame = 0
        if (!recording || !trace) return
        if (time - lastFrame >= 12) { lastFrame = time; sample() }
        if (trace.frames.length >= DIAGNOSTIC_LIMITS.frames) { void stop("limit"); return }
        frame = requestAnimationFrame(tick)
    }
    function listen(target: EventTarget, type: string, handler: EventListener, capture = false) {
        target.addEventListener(type, handler, { capture, passive: true })
        removers.push(() => target.removeEventListener(type, handler, capture))
    }
    function detach() {
        cancelAnimationFrame(frame); clearTimeout(timer); frame = timer = 0
        removers.forEach(remove => remove()); removers = []
        resizeObserver?.disconnect(); mutationObserver?.disconnect()
        resizeObserver = null; mutationObserver = null
    }
    async function save() {
        if (!trace || disposed) return
        onState("saving")
        try {
            const response = await fetch("/__preview/diagnostic", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(trace), signal: AbortSignal.timeout(15000) })
            if (!response.ok) throw Error("save failed")
            if (!disposed) onState("saved")
        } catch { if (!disposed) onState("error") }
    }
    async function stop(reason = "manual") {
        if (!recording || !trace) return
        if (trace.events.length < DIAGNOSTIC_LIMITS.events) event("stop")
        recording = false; detach(); trace.reason = reason; trace.elapsed = now()
        await save()
    }
    function start() {
        if (recording || disposed) return
        detach(); styles.clear(); nodes = []; refreshNodes = dirtyStyles = true
        started = performance.now(); lastFrame = lastStyles = -Infinity
        trace = { build: DIAGNOSTIC_BUILD, run: Date.now(), elapsed: 0, device: navigator.maxTouchPoints > 0 && matchMedia("(pointer: coarse)").matches ? "touch" : "desktop", reason: "manual", frames: [], events: [], styles: [] }
        recording = true
        resizeObserver = new ResizeObserver(entries => { dirtyStyles = true; for (const entry of entries) event("resize-observer", nodes.indexOf(entry.target as HTMLElement), 0, entry.contentRect.width, entry.contentRect.height) })
        mutationObserver = new MutationObserver(entries => {
            let mask = 0, count = 0
            for (const entry of entries) {
                if (entry.type === "childList") { refreshNodes = true; mask |= 1; count++ }
                else if (nodes.includes(entry.target as HTMLElement)) { dirtyStyles = true; mask |= entry.attributeName === "style" ? 2 : 4; count++ }
            }
            if (count) event("mutation-observer", -1, 0, mask, count)
        })
        mutationObserver.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ["style", "class", "hidden", "inert", "aria-hidden", "data-mobile-conversation-phase", "data-mobile-conversation-open"] })
        for (const type of DIAGNOSTIC_EVENTS.slice(2, 24)) {
            for (const capture of [true, false]) listen(document, type, e => {
                const point = (e as TouchEvent).touches?.[0] ?? e as PointerEvent
                event(type, role(e.target), capture ? 1 : 2, point.clientX ?? 0, point.clientY ?? 0, Number(e.defaultPrevented), (e as TouchEvent).touches?.length ?? Number((e as InputEvent).isComposing ?? false))
                if (type === "focusin" || type === "focusout") dirtyStyles = true
            }, capture)
        }
        for (const type of ["resize", "scroll", "scrollend"]) {
            if (visualViewport) listen(visualViewport, type, () => { dirtyStyles = true; event(`viewport-${type}`) })
            listen(window, type, () => { dirtyStyles = true; event(`window-${type}`) })
        }
        listen(window, MOBILE_CONVERSATION_VISIBILITY_EVENT, () => { refreshNodes = dirtyStyles = true; event("ownership") })
        listen(document, "visibilitychange", () => { event("visibility"); if (document.hidden) void stop("hidden") })
        listen(window, "pagehide", () => { event("pagehide"); void stop("pagehide") })
        discover(); event("start"); sample(); onState("recording")
        frame = requestAnimationFrame(tick)
        timer = window.setTimeout(() => { void stop("timeout") }, DIAGNOSTIC_LIMITS.duration)
    }
    return { start, stop: () => { void stop() }, retry: () => { void save() }, dispose: () => { disposed = true; recording = false; detach() } }
}
