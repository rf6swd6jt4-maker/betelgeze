import React, { useLayoutEffect, useRef, useState } from "react"
import { createRoot } from "react-dom/client"
import { flushSync } from "react-dom"
import { EditorView } from "@codemirror/view"
import { ChatComposerInput } from "@/components/communications/ChatComposerInput"
import { ChatMessageText } from "@/components/communications/ChatMessageText"
import { MessageReferences } from "@/components/communications/MessageReferences"

const h = React.createElement
const frame = () => new Promise(resolve => requestAnimationFrame(resolve))
const painted = async () => { await frame(); await frame() }
const uuid = number => `11111111-1111-4111-8111-${String(number).padStart(12, "0")}`
const context = { workspaceSlug: "synthetic", conversationId: uuid(50), userId: uuid(90), workspaceId: uuid(91) }
const plain = Array.from({ length: 60 }, (_, index) => `Message ${index}: Please **review this task** and confirm the next step.\n- Keep existing history intact.`)
const source = number => `@[ref](record:work_item:${uuid(number)})`
let requestCount = 0
globalThis.fetch = async (_url, options = {}) => {
    requestCount++
    const references = JSON.parse(options.body ?? "{}").references ?? []
    return new Response(JSON.stringify({ scope: { userId: context.userId, workspaceId: context.workspaceId }, results: references.map(reference => ({ ...reference, label: "Synthetic task", href: `/synthetic/work-items/${reference.id}` })) }), { headers: { "Content-Type": "application/json" } })
}
function Chat({ story }) {
    const [value, setValue] = useState("")
    const [active, setActive] = useState(true)
    const [messages, setMessages] = useState(plain)
    const inputRef = useRef(null)
    useLayoutEffect(() => { Object.assign(story, { value, setValue, setActive, setMessages, inputRef }) }, [story, value])
    return h(MessageReferences, { context, active },
        h("div", { className: "history" }, messages.map((body, index) => h("div", { key: index, className: "row" }, h(ChatMessageText, { body })))),
        h("div", { className: "composer" }, h(ChatComposerInput, { inputRef, value, onChange: setValue, onSend() {}, active, placeholder: "Synthetic message", referenceContext: context, mentionPeople: [] })))
}
const samples = { mountWork: [], mountPaint: [], typingWork: [], typingPaint: [], residentWork: [], residentPaint: [], updateWork: [], updatePaint: [], referencesPaint: [] }
const measure = async (name, action) => {
    const start = performance.now()
    flushSync(action)
    samples[`${name}Work`]?.push(performance.now() - start)
    await painted()
    samples[`${name}Paint`]?.push(performance.now() - start)
}
const warmup = 8, iterations = 48
try {
    for (let run = 0; run < warmup + iterations; run++) {
        const story = {}, root = createRoot(document.getElementById("stage"))
        await measure("mount", () => root.render(h(Chat, { story })))
        const editor = EditorView.findFromDOM(story.inputRef.current)
        for (let edit = 0; edit < 4; edit++) await measure("typing", () => editor.dispatch({ changes: { from: editor.state.doc.length, insert: ` plain ${edit}` }, userEvent: "input.type" }))
        flushSync(() => story.setActive(false)); await painted()
        await measure("resident", () => story.setActive(true))
        await measure("update", () => story.setMessages([...plain, "One new ordinary message"]))
        flushSync(() => root.unmount())
        if (run === warmup - 1) for (const key of Object.keys(samples)) samples[key] = []
    }
    if (requestCount !== 0) throw Error(`Ordinary chat made ${requestCount} reference requests`)
    if (!FIXTURE_BASELINE) {
        for (let run = 0; run < 16; run++) {
            const story = {}, root = createRoot(document.getElementById("stage"))
            flushSync(() => root.render(h(Chat, { story })))
            const start = performance.now()
            flushSync(() => story.setMessages([`Please review ${source(20)} and ${source(21)}`, `Again ${source(20)}`]))
            while (document.querySelectorAll(".history a").length !== 3) {
                if (performance.now() - start > 2000) throw Error("Reference labels did not resolve")
                await frame()
            }
            await painted()
            samples.referencesPaint.push(performance.now() - start)
            flushSync(() => root.unmount())
        }
    }
    const report = { status: "complete", baseline: FIXTURE_BASELINE, warmup, iterations, referenceRequests: requestCount, samples, errors: [] }
    window.commsReferencePerformance = report
    document.querySelector("#result").textContent = JSON.stringify(report)
} catch (error) {
    window.commsReferencePerformance = { status: "complete", errors: [String(error)], samples }
    document.querySelector("#result").textContent = JSON.stringify(window.commsReferencePerformance)
}
