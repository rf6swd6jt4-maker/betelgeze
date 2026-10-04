import React, { useLayoutEffect, useRef, useState } from "react"
import { createRoot } from "react-dom/client"
import { flushSync } from "react-dom"
import { EditorView } from "@codemirror/view"
import { undo, redo } from "@codemirror/commands"
import { ChatComposerInput } from "@/components/communications/ChatComposerInput"
import { WorkspaceNavigationProvider } from "@/components/workspace/WorkspaceNavigation"
import { MessageReferences } from "@/components/communications/MessageReferences"
import { ChatMessageText } from "@/components/communications/ChatMessageText"
import { selectedMessageQuote } from "@/lib/communications/message-quotes"
import { nativeCapture } from "./navigation-handler.js"

const h = React.createElement
const assert = (ok, message) => { if (!ok) throw Error(message) }
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
const frame = () => new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)))
const uuid = number => `11111111-1111-4111-8111-${String(number).padStart(12, "0")}`
const context = { workspaceSlug: "synthetic", conversationId: uuid(50), userId: uuid(90), workspaceId: uuid(91) }
const people = Array.from({ length: 9 }, (_, index) => ({ id: uuid(index + 1), name: `Alex Person ${index + 1}` }))
const record = (number, label = `Draft ${number}`) => ({ type: "work_item", id: uuid(number), label, href: `/synthetic/work-items/${uuid(number)}` })
const payload = (results, scope = context) => ({ results, scope: { userId: scope.userId, workspaceId: scope.workspaceId } })
const source = number => `@[ref](record:work_item:${uuid(number)})`
const personDestinations = new Map([[uuid(1), `/synthetic/communications?mode=team&dm=${uuid(1)}`]])
const cases = []
const define = (name, action) => cases.push({ name, action })
const realFetch = globalThis.fetch

function Composer({ story }) {
    const [value, setValue] = useState("")
    const [active, setActive] = useState(true)
    const [scope, setScope] = useState(context)
    const [messages, setMessages] = useState(["Existing messages remain mounted"])
    const [mentionPeople, setMentionPeople] = useState(people)
    const [quoteSelection, setQuoteSelection] = useState(false)
    const input = useRef(null)
    const [labels, setLabels] = useState(new Map())
    useLayoutEffect(() => { Object.assign(story, { value, setValue, setActive, setScope, setMessages, setMentionPeople, setQuoteSelection, input }) }, [story, value])
    const navigation = { tabId: "synthetic", workspaceSlug: scope.workspaceSlug, url: "/synthetic/communications", active, push: href => story.navigation.push(href), prefetch: () => story.prefetches++, context() {} }
    return h(WorkspaceNavigationProvider, { value: navigation }, h(MessageReferences, { context: scope, active, personDestinations },
        h("header", { "data-fixture-header": true, style: { flex: "none", height: 44 } }, "Synthetic conversation"),
        h("div", { style: { flex: 1, minHeight: 0, overflow: "auto" }, "data-fixture-history": true, onClickCapture: nativeCapture({ active, navigation, workspaceSlug: scope.workspaceSlug }) }, messages.map((body, index) => h("div", { key: index, style: { marginBottom: 12 } }, h(ChatMessageText, { body, quoteSelection })))),
        h("div", { style: { display: "flex", flex: "none", border: "1px solid #333", borderRadius: 12, padding: 8 }, "data-mobile-conversation-surface": true },
            h(ChatComposerInput, { inputRef: input, value, onChange: setValue, onSend: () => story.sends++, active, placeholder: "Synthetic message", mentionPeople, referenceContext: scope, referenceLabels: labels, onReferenceSelected: result => setLabels(previous => new Map(previous).set(`${result.type}:${result.id}`, result)) }))))
}

async function fixture() {
    const requests = []
    globalThis.fetch = (url, options = {}) => new Promise((resolve, reject) => requests.push({ url: String(url), body: options.body, method: options.method ?? "GET", signal: options.signal, resolve: value => resolve(new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json" } })), reject }))
    const story = { sends: 0, navigation: [], prefetches: 0 }
    const root = createRoot(document.getElementById("stage"))
    flushSync(() => root.render(h(Composer, { story })))
    await frame()
    const editor = () => EditorView.findFromDOM(story.input.current)
    const write = value => {
        story.input.current.focus({ preventScroll: true })
        const view = editor()
        flushSync(() => view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value }, selection: { anchor: value.length }, userEvent: "input.type" }))
    }
    const key = key => { story.input.current.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })); return frame() }
    const options = () => [...document.querySelectorAll('[role="option"]')]
    const mutate = action => flushSync(() => action(story))
    return { requests, story, editor, write, key, options, mutate, close() { flushSync(() => root.unmount()); globalThis.fetch = realFetch } }
}

define("ordinary entry and typing add no discovery or prefetch work", async f => {
    await delay(200)
    f.write("Ordinary draft")
    await delay(200)
    assert(f.requests.length === 0, "Closed picker fetched references")
    assert(f.story.prefetches === 0, "Composer prefetched record destinations")
    assert(!f.options().length, "Ordinary typing opened the picker")
})

define("local suggestions appear immediately in a compact viewport with eight bounded choices", async f => {
    f.write("@")
    await frame()
    assert(f.options().length === 8, `Expected eight bounded local choices, got ${f.options().length}`)
    assert(f.requests.length === 0, "Local suggestions waited on server search")
    assert(document.activeElement === f.story.input.current, "Picker stole composer focus")
    for (const row of f.options()) assert(row.getBoundingClientRect().height >= 44, "Mobile row is smaller than 44px")
    const bounds = document.querySelector('[role="listbox"]').getBoundingClientRect()
    assert(bounds.left >= 7 && bounds.right <= innerWidth - 7, "Picker escaped viewport width")
    const picker = document.querySelector("[data-reference-picker]")
    assert(picker.clientHeight <= 192 && picker.scrollHeight > picker.clientHeight, "All choices expanded the compact four-row viewport")
})

function pickerGeometry() {
    const rect = selector => {
        const bounds = document.querySelector(selector).getBoundingClientRect()
        return { top: bounds.top, bottom: bounds.bottom, left: bounds.left, right: bounds.right }
    }
    return { popup: rect("[data-anchored-popup]"), composer: rect("[data-mobile-conversation-surface]"), anchor: rect(".cm-content"), header: rect("[data-fixture-header]"), documentScroll: document.scrollingElement.scrollTop, historyScroll: document.querySelector("[data-fixture-history]").scrollTop }
}
function unchangedPickerGeometry(before, message) {
    const after = pickerGeometry()
    for (const name of ["popup", "composer", "anchor", "header"]) for (const edge of ["top", "bottom", "left", "right"]) {
        assert(Math.abs(before[name][edge] - after[name][edge]) <= 1.5, `${message}: ${name}.${edge} moved from ${before[name][edge]} to ${after[name][edge]}`)
    }
    assert(after.documentScroll === before.documentScroll && after.historyScroll === before.historyScroll, `${message}: surrounding content scrolled`)
}
async function withConstrainedPicker(action) {
    const style = document.createElement("style")
    style.textContent = "[data-reference-picker]{max-height:104px!important}"
    document.head.append(style)
    try { await action() } finally { style.remove() }
}
function touchGesture(target, fromY, toY) {
    const fire = (type, y) => {
        const event = new Event(type, { bubbles: true, cancelable: true })
        Object.defineProperty(event, "touches", { value: type === "touchend" ? [] : [{ clientX: 60, clientY: y }] })
        target.dispatchEvent(event)
        return event.defaultPrevented
    }
    fire("touchstart", fromY)
    const prevented = fire("touchmove", toY)
    fire("touchend", toY)
    return prevented
}

define("pending and resolved picker scroll only its list without moving its anchor or surrounding layout", async f => {
    await withConstrainedPicker(async () => {
        f.write("@"); await delay(220); await frame()
        const picker = document.querySelector("[data-reference-picker]")
        const popup = document.querySelector("[data-anchored-popup]")
        const before = pickerGeometry()
        assert(picker.scrollHeight > picker.clientHeight, "Scroll test did not constrain the list")
        assert(popup.scrollHeight <= popup.clientHeight + 1, "Hidden loading status escaped the picker into popup overflow")
        picker.scrollTop = picker.scrollHeight
        await frame(); await frame()
        assert(picker.scrollTop > 0, "Pending picker could not scroll")
        unchangedPickerGeometry(before, "Pending internal scroll")
        f.requests[0].resolve(payload([]))
        await frame(); await frame()
        picker.scrollTop = 0
        await frame(); await frame()
        unchangedPickerGeometry(before, "Loading completion and reverse scroll")
        picker.scrollTop = picker.scrollHeight
        await frame(); await frame()
        unchangedPickerGeometry(before, "Resolved internal scroll")
        const last = f.options().at(-1).getBoundingClientRect(), bounds = picker.getBoundingClientRect()
        assert(last.top >= bounds.top - 1 && last.bottom <= bounds.bottom + 1, "Final choice could not be fully revealed")
        assert(document.activeElement === f.story.input.current, "Internal scrolling stole composer focus")
        assert(f.requests.length === 1, "Internal scrolling fetched additional references")
    })
})

define("picker touch policy allows internal travel and contains both scroll edges", async f => {
    await withConstrainedPicker(async () => {
        f.write("@"); await delay(220)
        const picker = document.querySelector("[data-reference-picker]"), row = f.options()[0]
        picker.scrollTop = 0
        assert(!touchGesture(row, 120, 80), "Picker prevented native scrolling toward later choices")
        assert(touchGesture(row, 80, 120), "Top-edge drag was not contained locally")
        picker.scrollTop = picker.scrollHeight
        await frame(); await frame()
        assert(touchGesture(f.options().at(-1), 120, 80), "Bottom-edge drag was not contained locally")
        assert(!touchGesture(f.options().at(-1), 80, 120), "Picker prevented native scrolling toward earlier choices")
        assert(touchGesture(document.querySelector("[data-anchored-popup]"), 120, 80), "Popup padding drag escaped local containment")
    })
})

define("short picker contains edge gestures and selecting the final visible row keeps focus", async f => {
    f.mutate(story => story.setMentionPeople(people.slice(0, 4)))
    f.write("@"); await delay(220)
    f.requests[0].resolve(payload([])); await frame(); await frame()
    const picker = document.querySelector("[data-reference-picker]")
    assert(picker.scrollHeight <= picker.clientHeight + 1, "Short-list edge test unexpectedly overflowed")
    const before = pickerGeometry(), row = f.options().at(-1)
    assert(touchGesture(row, 120, 80) && touchGesture(row, 80, 120), "Non-overflowing picker allowed page-pan gestures")
    unchangedPickerGeometry(before, "Short-list edge gestures")
    row.dispatchEvent(new PointerEvent("pointerdown", { pointerType: "touch", bubbles: true, cancelable: true }))
    row.click(); await frame()
    assert(f.story.value.includes(`mention:${uuid(4)}`), "Final visible choice was not inserted")
    assert(document.activeElement === f.story.input.current, "Choice insertion stole composer focus")
})

define("search debounces rapid typing and ignores a superseded response", async f => {
    f.write("@D")
    await delay(40)
    f.write("@Draft")
    await delay(220)
    assert(f.requests.length === 1, `Expected one coalesced search, got ${f.requests.length}`)
    assert(new URL(f.requests[0].url, location.href).searchParams.get("q") === "Draft", "Search used obsolete text")
    f.write("@Changed")
    await delay(220)
    assert(f.requests[0].signal.aborted, "Superseded request was not aborted")
    f.requests[1].resolve(payload([record(20, "Changed result")]))
    await frame(); await frame()
    f.requests[0].resolve(payload([record(21, "Draft OLD secret")]))
    await frame(); await frame()
    assert(document.body.textContent.includes("Changed result"), "Latest result missing")
    assert(!document.body.textContent.includes("OLD secret"), "Late search replaced new results")
})

define("Escape and inactive tabs abort discovery and release the popup", async f => {
    f.write("@Draft"); await delay(220)
    await f.key("Escape")
    assert(f.requests[0].signal.aborted, "Escape left search active")
    assert(!f.options().length, "Escape left menu visible")
    f.write("@Other"); await delay(220)
    f.mutate(story => story.setActive(false)); await frame()
    assert(f.requests[1].signal.aborted, "Inactive tab retained a search")
    assert(!f.options().length, "Inactive tab retained a popup")
    f.requests[1].resolve(payload([record(20, "Late hidden result")]))
    await frame()
    assert(!document.body.textContent.includes("Late hidden result"), "Hidden response published")
    assert(f.story.value === "@Other", "Tab departure discarded the draft")
})

define("record selection persists only identity and keeps keyboard focus", async f => {
    f.write("Review @Draft"); await delay(220)
    f.requests[0].resolve(payload([record(20, "Private project draft")]))
    await frame(); await frame()
    const row = f.options()[0]
    assert(row, "No reference option")
    row.dispatchEvent(new PointerEvent("pointerdown", { pointerType: "touch", bubbles: true, cancelable: true }))
    row.click(); await frame()
    assert(f.story.value === `Review @[ref](record:work_item:${uuid(20)}) `, `Unexpected persisted reference: ${f.story.value}`)
    assert(!f.story.value.includes("Private"), "Protected label entered the message body")
    assert(document.activeElement === f.story.input.current, "Selection dismissed composer keyboard focus")
    assert(!f.options().length, "Selection left picker open")
    assert(f.story.sends === 0, "Selection sent the message")
})

define("people keyboard selection retains mention identity and does not send", async f => {
    f.write("@Alex"); await frame()
    await f.key("ArrowDown"); await f.key("Enter")
    assert(f.story.value.includes(`mention:${uuid(2)}`), "Arrow/Enter chose the wrong person")
    assert(f.story.sends === 0, "Mention selection submitted a message")
    assert(!f.options().length, "Keyboard selection left picker open")
})

define("account changes fence prior results even if transport ignores abort", async f => {
    f.write("@Draft"); await delay(220)
    f.mutate(story => story.setScope({ ...context, userId: uuid(92) })); await frame()
    f.requests[0].resolve(payload([record(20, "Previous account secret")]))
    await frame(); await frame()
    assert(f.requests[0].signal.aborted, "Account change retained old search")
    assert(!document.body.textContent.includes("Previous account secret"), "Previous account title leaked")
})

define("server scope mismatch never becomes an available reference", async f => {
    f.write("@Draft"); await delay(220)
    f.requests[0].resolve(payload([record(20, "Foreign actor secret")], { ...context, userId: uuid(99) }))
    await frame(); await frame()
    assert(!document.body.textContent.includes("Foreign actor secret"), "Mismatched actor result leaked")
    assert(!f.options().length, "Mismatched actor remained selectable")
})

define("returning to an earlier query does not resurrect its completed result", async f => {
    f.write("@Draft"); await delay(220)
    f.requests[0].resolve(payload([record(20, "Old completed result")]))
    await frame(); await frame()
    assert(document.body.textContent.includes("Old completed result"), "Initial result did not load")
    f.write("@Other"); await frame()
    f.write("@Draft"); await frame()
    assert(!document.body.textContent.includes("Old completed result"), "Earlier completed result reappeared before fresh authorization")
    await delay(220)
    const fresh = f.requests.at(-1)
    assert(fresh !== f.requests[0], "Returning query reused its earlier read")
    fresh.resolve(payload([record(21, "Fresh current result")]))
    await frame(); await frame()
    assert(document.body.textContent.includes("Fresh current result"), "Fresh result missing")
})

define("late discovery cannot move the highlighted choice beneath a keyboard selection", async f => {
    f.write("@Alex"); await f.key("ArrowDown")
    const selected = f.options()[1].getAttribute("aria-label")
    await delay(220)
    f.requests[0].resolve(payload([record(20, "Alex")]))
    await frame(); await frame()
    assert(f.options()[1].getAttribute("aria-label") === selected, "Server results moved a highlighted choice")
    await f.key("Enter")
    assert(f.story.value.includes(`mention:${uuid(2)}`), "Late results replaced keyboard selection")
})

define("atomic reference deletion and undo never expose raw identity syntax", async f => {
    f.write("@Draft"); await delay(220)
    f.requests[0].resolve(payload([record(20, "Private draft")]))
    await frame(); await frame()
    f.options()[0].click(); await frame()
    const value = f.story.value
    await f.key("Backspace"); await f.key("Backspace")
    assert(f.story.value === "", `Backspace left part of reference syntax: ${f.story.value}`)
    assert(!f.story.input.current.textContent.includes("record:"), "Reference syntax appeared in editor")
    flushSync(() => undo(f.editor())); await frame()
    // CodeMirror may coalesce these immediate synthetic actions into the
    // original completion group. Both undo boundaries must stay valid.
    assert(f.story.value === "@Draft" || f.story.value.trimEnd() === value.trimEnd(), `Undo restored partial reference syntax: ${f.story.value}`)
    flushSync(() => redo(f.editor())); await frame()
    assert(f.story.value === "", "Redo did not remove complete reference")
})

define("pointer selection stays tied to the pressed row while results arrive", async f => {
    f.write("@Alex"); await frame()
    const row = f.options()[1]
    row.dispatchEvent(new PointerEvent("pointerdown", { pointerType: "touch", bubbles: true, cancelable: true }))
    await delay(220)
    f.requests[0].resolve(payload([record(20, "Alex")]))
    await frame(); await frame()
    row.click(); await frame()
    assert(f.story.value.includes(`mention:${uuid(2)}`), "Late result changed the touch target")
    assert(document.activeElement === f.story.input.current, "Touch selection stole editor focus")
})

define("failed discovery remains a visible failure without erasing the draft", async f => {
    f.write("@Draft"); await delay(220)
    f.requests[0].reject(new Error("Synthetic offline failure"))
    await frame(); await frame()
    assert(document.body.textContent.includes("search unavailable"), "Failed discovery claimed no matches")
    assert(f.story.value === "@Draft", "Failed discovery erased query")
    assert(f.requests.length === 1, "Failed discovery automatically retried")
})

define("visible references batch by unique identity and denied results remain non-links", async f => {
    f.mutate(story => story.setMessages([`Review ${source(20)} and ${source(21)}`, `Again ${source(20)}`]))
    await delay(100)
    assert(f.requests.length === 1 && f.requests[0].method === "POST", "Visible references did not use one batch")
    const sent = JSON.parse(f.requests[0].body)
    assert(sent.references.length === 2, "Repeated reference was resolved twice")
    assert(document.body.textContent.includes("Checking reference"), "Unresolved state was not distinct")
    f.requests[0].resolve(payload([record(20, "Permitted draft")]))
    await frame(); await frame()
    const links = [...document.querySelectorAll("[data-fixture-history] a")]
    assert(links.length === 2 && links.every(link => link.textContent === "Permitted draft"), "Authorized repeated references were not links")
    const denied = document.querySelector(`[data-chat-record-reference="work_item:${uuid(21)}"]`)
    assert(denied.textContent === "Unavailable reference" && !denied.querySelector("a,button"), "Denied reference remained actionable")
    assert(denied.querySelector('[aria-disabled="true"]'), "Unavailable reference lacks disabled semantics")
    links[0].click(); await frame()
    assert(f.story.navigation[0] === record(20).href, "Reference did not navigate directly through actual native capture")
    assert(f.story.prefetches === 0, "Rendered reference prefetched a destination")
})

define("inactive reference messages do no resolution work and abort late active reads", async f => {
    f.mutate(story => { story.setActive(false); story.setMessages([source(20)]) }); await delay(100)
    assert(f.requests.length === 0, "Hidden message initiated resolution")
    f.mutate(story => story.setActive(true)); await delay(100)
    assert(f.requests.length === 1, "Visible reactivation failed to resolve")
    f.mutate(story => story.setActive(false)); await frame()
    assert(f.requests[0].signal.aborted, "Departure did not abort reference resolution")
    f.requests[0].resolve(payload([record(20, "Late hidden title")]))
    await frame(); await frame()
    assert(!document.body.textContent.includes("Late hidden title"), "Hidden result revealed protected title")
})

define("offscreen history references resolve only when scrolled into view", async f => {
    f.mutate(story => story.setMessages([...Array.from({ length: 70 }, (_, index) => `Ordinary historical message ${index}`), source(20)]))
    await delay(100)
    assert(f.requests.length === 0, "Offscreen history reference resolved eagerly")
    const pane = document.querySelector("[data-fixture-history]")
    pane.scrollTop = pane.scrollHeight
    await delay(100)
    assert(f.requests.length === 1, "Newly visible history reference did not resolve")
})

define("quote selection uses generic text with stable offsets after a resolved record", async f => {
    const body = `Before ${source(20)} after`
    f.mutate(story => story.setMessages([body])); await delay(100)
    f.requests[0].resolve(payload([record(20, "Much longer private project title")]))
    await frame(); await frame()
    f.mutate(story => story.setQuoteSelection(true)); await frame()
    const root = document.querySelector("[data-chat-message-text]")
    assert(root.textContent === "Before Reference after", `Quote mode exposed variable reference label: ${root.textContent}`)
    const range = document.createRange()
    range.selectNodeContents(root)
    const selection = document.getSelection()
    selection.removeAllRanges(); selection.addRange(range)
    const quote = selectedMessageQuote(root, body)
    assert(quote.text === "Before Reference after" && quote.start === 0 && quote.end === 22, "Quote offsets diverged from persisted generic text")
    selection.removeAllRanges()
    assert(!root.querySelector("a"), "Quote selection retained navigation action")
})

define("failed reference resolution is distinct from confirmed access denial", async f => {
    f.mutate(story => story.setMessages([source(20)])); await delay(100)
    f.requests[0].reject(new Error("Synthetic unavailable connection"))
    await frame(); await frame()
    const root = document.querySelector("[data-chat-record-reference]")
    assert(root.textContent === "Reference check failed", "Failed request was represented as denied")
    assert(!root.querySelector("a"), "Failed check retained an active destination")
    assert(f.requests.length === 1, "Failure entered automatic polling")
})

define("people navigate directly using the current roster without discovery requests", async f => {
    f.mutate(story => story.setMessages([`Ask @[Alex](mention:${uuid(1)}) and @[Former](mention:${uuid(2)})`]))
    await frame(); await frame()
    const root = document.querySelector("[data-chat-message-text]")
    const links = [...root.querySelectorAll("a")]
    assert(links.length === 1 && links[0].textContent === "@Alex", "Roster-authorized person was not the only link")
    assert(root.querySelector('[aria-disabled="true"]')?.textContent === "@Former", "Unavailable person remained actionable")
    links[0].click(); await frame()
    assert(f.story.navigation[0] === personDestinations.get(uuid(1)), "Person did not navigate directly to their conversation")
    assert(f.requests.length === 0 && f.story.prefetches === 0, "People references introduced discovery/prefetch work")
})

if (new URLSearchParams(location.search).has("native-input")) {
    // This branch is driven by browser input, not DOM-dispatched clicks. Keep
    // the actual editor/source observable so focus loss cannot mask a failure.
    const f = await fixture()
    const kind = new URLSearchParams(location.search).get("kind")
    f.write(kind === "record" ? "@Draft" : "@")
    await delay(220)
    f.requests[0].resolve(payload(kind === "record" ? [record(20, "Private project draft")] : []))
    await frame(); await frame()
    window.commsReferenceNativeInput = {
        ready: true,
        snapshot: () => ({
            value: f.story.value,
            focused: document.activeElement === f.story.input.current,
            sends: f.story.sends,
            requests: f.requests.length,
            options: f.options().length,
            pickerScroll: document.querySelector("[data-reference-picker]")?.scrollTop,
            geometry: Object.fromEntries(["[data-mobile-conversation-surface]", "[data-fixture-header]", ".cm-content"].map(selector => {
                const bounds = document.querySelector(selector).getBoundingClientRect()
                return [selector, { top: bounds.top, bottom: bounds.bottom, left: bounds.left, right: bounds.right }]
            })),
            documentScroll: document.scrollingElement.scrollTop,
            historyScroll: document.querySelector("[data-fixture-history]").scrollTop,
        }),
    }
} else if (new URLSearchParams(location.search).has("preview")) {
    const f = await fixture()
    f.mutate(story => story.setMessages([`@[Alex](mention:${uuid(1)}), please review ${source(20)} before launch.`, `This earlier file is ${source(21)}.`]))
    await delay(100)
    f.requests[0].resolve(payload([record(20, "Homepage approval")]))
    await frame(); await frame()
    f.write("@")
    await delay(220)
    f.requests[1].resolve(payload([record(20, "Homepage approval"), { type: "asset", id: uuid(22), label: "Homepage draft.pdf", href: `/synthetic/assets/${uuid(22)}` }]))
    await frame(); await frame()
    window.commsReferencePreview = { ready: true }
} else {
    const results = []
    for (const { name, action } of cases) {
        let f
        try { f = await fixture(); await action(f); results.push({ name, passed: true }) }
        catch (error) { results.push({ name, passed: false, error: String(error) }) }
        finally { f?.close() }
    }
    const report = { status: "complete", total: results.length, passed: results.filter(result => result.passed).length, cases: results }
    window.commsReferencesFixtureResult = report
    document.querySelector("#result").textContent = JSON.stringify(report, null, 2)
}
