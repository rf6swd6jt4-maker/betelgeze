"use client"

import { useLayoutEffect, useRef, useState, type RefObject } from "react"
import { createComposerPointerFocus } from "./composer-pointer-focus"
import { Annotation, Compartment, EditorState, StateField, Transaction } from "@codemirror/state"
import { Decoration, EditorView, WidgetType, drawSelection, keymap, placeholder as editorPlaceholder } from "@codemirror/view"
import { defaultKeymap, history, historyKeymap, insertNewline } from "@codemirror/commands"
import { chatComposerDecorations, chatComposerListMarkers, chatLineStartsWithHeader, chatListEdit } from "@/lib/chat-formatting"

import { chatMentions, chatMentionSource, mentionQuery, matchingMentionPeople, type MentionPerson } from "@/lib/chat-formatting"
import { ComposerMentionPicker } from "./ComposerMentionPicker"

class MentionWidget extends WidgetType {
    constructor(readonly text: string) { super() }
    eq(other: MentionWidget) { return this.text === other.text }
    toDOM() { const node = document.createElement("strong"); node.textContent = this.text; return node }
    ignoreEvent() { return false }
}

const externalChange = Annotation.define<boolean>()
const formatting = StateField.define({
    create: (state) => decorate(state.doc.toString()),
    update: (value, transaction) => transaction.docChanged ? decorate(transaction.newDoc.toString()) : value,
    provide: (field) => [
        EditorView.decorations.from(field, (value) => value.decorations),
        EditorView.atomicRanges.of((view) => view.state.field(field).atomic),
    ],
})
class ListMarker extends WidgetType {
    constructor(readonly marker: string, readonly width: number) { super() }
    eq(other: ListMarker) { return other.marker === this.marker && other.width === this.width }
    toDOM() {
        const marker = document.createElement("span")
        marker.className = "chat-list-marker"
        marker.dataset.chatListMarker = this.marker
        marker.style.width = `${this.width}em`
        marker.setAttribute("aria-hidden", "true")
        if (this.marker.startsWith("[")) {
            const box = document.createElement("span")
            box.className = "chat-list-box"
            box.textContent = /^\[[xX]\]$/.test(this.marker) ? "✓" : ""
            marker.appendChild(box)
        } else marker.textContent = this.marker === "-" ? "•" : this.marker
        return marker
    }
    ignoreEvent() { return false }
}
function decorate(body: string) {
    const ranges = chatComposerDecorations(body).map(({ from, to, className }) => Decoration.mark({ class: className }).range(from, to))
    const atomic = []
    for (const mention of chatMentions(body)) {
        const replacement = Decoration.replace({ widget: new MentionWidget(mention.text) }).range(mention.from, mention.to)
        ranges.push(replacement)
        atomic.push(replacement)
    }
    for (const item of chatComposerListMarkers(body)) {
        const replacement = Decoration.replace({ widget: new ListMarker(item.marker, item.width) }).range(item.from, item.to)
        ranges.push(replacement)
        atomic.push(replacement)
        ranges.push(Decoration.line({ attributes: { class: "chat-list-line", style: `padding-left: ${item.indent * 0.5 + item.width}em; text-indent: -${item.width}em` } }).range(item.from))
    }
    let offset = 0
    const lines = body.split("\n")
    for (let index = 0; index < lines.length; index++) {
        if (index > 0 && lines[index - 1].trim() && chatLineStartsWithHeader(lines[index])) ranges.push(Decoration.line({ class: "chat-heading-line" }).range(offset))
        offset += lines[index].length + 1
    }
    return { decorations: Decoration.set(ranges, true), atomic: Decoration.set(atomic, true) }
}

export function ChatComposerInput({ inputRef, value, onChange, onSend, onFocus, onBlur, disabled = false, sendDisabled = false, placeholder, maxLength = 8000, portal = false, mentionPeople }: {
    mentionPeople?: MentionPerson[]
    inputRef: RefObject<HTMLElement | null>
    value: string
    onChange: (value: string) => void
    onSend: () => void
    onFocus?: () => void
    onBlur?: () => void
    disabled?: boolean
    sendDisabled?: boolean
    placeholder: string
    maxLength?: number
    portal?: boolean
}) {
    const host = useRef<HTMLDivElement>(null)
    const editor = useRef<EditorView | null>(null)
    const current = useRef({ value, onChange, onSend, onFocus, onBlur, disabled, sendDisabled, placeholder, maxLength })
    useLayoutEffect(() => { current.current = { value, onChange, onSend, onFocus, onBlur, disabled, sendDisabled, placeholder, maxLength } })
    const [mentionMenu, setMentionMenu] = useState<{ from: number; to: number; query: string; active: number; anchor: HTMLElement } | null>(null)
    const menu = useRef(mentionMenu)
    const peopleRef = useRef(mentionPeople)
    useLayoutEffect(() => { peopleRef.current = mentionPeople })
    function updateMenu(next: typeof mentionMenu) { menu.current = next; setMentionMenu(next) }
    function selectMention(person: MentionPerson) {
        const view = editor.current, selection = menu.current
        if (!view || !selection || current.current.disabled) return
        const source = chatMentionSource(person) + " "
        if (view.state.doc.length - (selection.to - selection.from) + source.length > current.current.maxLength) return
        updateMenu(null)
        view.dispatch({ changes: { from: selection.from, to: selection.to, insert: source }, selection: { anchor: selection.from + source.length }, userEvent: "input.complete", scrollIntoView: true })
        view.contentDOM.focus({ preventScroll: true })
    }
    const mentionActions = useRef({ selectMention, updateMenu })
    useLayoutEffect(() => { mentionActions.current = { selectMention, updateMenu } })
    const historyConfig = useRef(new Compartment())
    const placeholderConfig = useRef(new Compartment())
    useLayoutEffect(() => {
        if (!host.current) return
        const editList = (view: EditorView, key: "Enter" | "Tab", outdent = false) => {
            const selection = view.state.selection.main
            const edit = chatListEdit(view.state.doc.toString(), selection.from, selection.to, key, outdent)
            if (!edit) return false
            // A minimal change preserves editor history, composition, and selection.
            const old = view.state.doc.toString()
            let from = 0
            while (from < old.length && from < edit.value.length && old[from] === edit.value[from]) from++
            let end = old.length, newEnd = edit.value.length
            while (end > from && newEnd > from && old[end - 1] === edit.value[newEnd - 1]) { end--; newEnd-- }
            view.dispatch({ changes: { from, to: end, insert: edit.value.slice(from, newEnd) }, selection: { anchor: edit.start, head: edit.end }, scrollIntoView: true, userEvent: "input" })
            return true
        }
        const chooseMention = () => {
            const state = menu.current
            if (!state || !peopleRef.current?.length) return false
            const person = matchingMentionPeople(peopleRef.current ?? [], state.query)[state.active]
            if (person) mentionActions.current.selectMention(person)
            else mentionActions.current.updateMenu(null)
            return true
        }
        const moveMention = (direction: number) => {
            const state = menu.current
            if (!state || !peopleRef.current?.length) return false
            const count = matchingMentionPeople(peopleRef.current ?? [], state.query).length
            mentionActions.current.updateMenu({ ...state, active: count ? (state.active + direction + count) % count : 0 })
            return true
        }
        const enter = (view: EditorView) => {
            if (view.composing || current.current.disabled) return false
            if (chooseMention()) return true
            if (editList(view, "Enter")) return true
            if (!current.current.sendDisabled) current.current.onSend()
            return true
        }
        const pointerFocus = createComposerPointerFocus(() => {
            const view = editor.current
            if (view && !current.current.disabled) view.contentDOM.focus({ preventScroll: true })
        })
        const view = new EditorView({
            parent: host.current,
            state: EditorState.create({
                doc: current.current.value,
                extensions: [
                    formatting, historyConfig.current.of(history()), EditorView.lineWrapping,
                    drawSelection({ drawRangeCursor: false }),
                    keymap.of([
                        { key: "Enter", run: enter, shift: insertNewline },
                        { key: "ArrowDown", run: () => moveMention(1) },
                        { key: "ArrowUp", run: () => moveMention(-1) },
                        { key: "Escape", run: () => { if (!menu.current) return false; mentionActions.current.updateMenu(null); return true } },
                        { key: "Tab", run: (view) => chooseMention() || editList(view, "Tab"), shift: (view) => editList(view, "Tab", true) },
                        ...historyKeymap, ...defaultKeymap,
                    ]),
                    EditorView.inputHandler.of((view, from, to, text) => {
                        if (text !== "\n" || view.composing) return false
                        if (from !== view.state.selection.main.from || to !== view.state.selection.main.to) return false
                        if (chooseMention()) return true
                        return editList(view, "Enter")
                    }),
                    EditorState.transactionFilter.of((transaction) => {
                        if (transaction.annotation(externalChange)) return transaction
                        return transaction.docChanged && (current.current.disabled || (transaction.newDoc.length > current.current.maxLength && transaction.newDoc.length > transaction.startState.doc.length)) ? [] : transaction
                    }),
                    EditorView.contentAttributes.of(() => ({
                        "aria-label": current.current.placeholder,
                        "aria-multiline": "true",
                        "aria-disabled": String(current.current.disabled),
                        contenteditable: String(!current.current.disabled),
                        enterkeyhint: /^ *(?:-|\d+\.|\[[ xX]\]) /m.test(current.current.value) ? "enter" : "send",
                        spellcheck: "true",
                        autocorrect: "on",
                        autocapitalize: "sentences",
                        writingsuggestions: "true",
                        "data-chat-composer": "true",
                    })),
                    placeholderConfig.current.of(editorPlaceholder(current.current.placeholder)),
                    EditorView.updateListener.of((update) => {
                        if (update.docChanged || update.selectionSet) {
                            const selection = update.state.selection.main
                            const query = peopleRef.current?.length && !current.current.disabled && !update.transactions.some((transaction) => transaction.annotation(externalChange))
                                ? mentionQuery(update.state.doc.toString(), selection.from, selection.to) : null
                            mentionActions.current.updateMenu(query ? { ...query, active: 0, anchor: update.view.contentDOM } : null)
                        }
                        if (update.docChanged && !update.transactions.some((transaction) => transaction.annotation(externalChange))) current.current.onChange(update.state.doc.toString())
                    }),
                    EditorView.domEventHandlers({
                        focus: () => { current.current.onFocus?.() },
                        blur: () => { current.current.onBlur?.() },
                        ...pointerFocus,
                    }),
                    // Size the scroller directly: its default 1.4 line-height
                    // overrides editor inheritance, and a bare "&" inside this
                    // theme's media rule is omitted by the style generator.
                    // Symmetric padding + one line exactly fills the control.
                    EditorView.theme({
                        "&": { backgroundColor: "transparent", color: "inherit" },
                        "&.cm-focused": { outline: "none" },
                        ".cm-scroller": { fontFamily: "inherit", fontSize: "16px", lineHeight: "24px", maxHeight: "116px", overflow: "auto", overscrollBehavior: "contain" },
                        ".cm-content": { boxSizing: "border-box", padding: "10px 0", minHeight: "44px" },
                        ".cm-line": { padding: "0" },
                        ".cm-placeholder": { color: "inherit", opacity: "0.4" },
                        ".chat-syntax": { color: "color-mix(in srgb, currentColor 35%, transparent)" },
                        ".cm-cursor": { borderLeftColor: "currentColor" },
                        ".cm-selectionBackground": { backgroundColor: "color-mix(in srgb, currentColor 20%, transparent)" },
                        "&.cm-focused .cm-selectionBackground": { backgroundColor: "color-mix(in srgb, currentColor 25%, transparent)" },
                        ".chat-list-marker": { display: "inline-block", textIndent: "0", verticalAlign: "baseline", whiteSpace: "nowrap" },
                        ".chat-list-box": { display: "inline-flex", boxSizing: "border-box", width: "0.85em", height: "0.85em", border: "1px solid currentColor", borderRadius: "3px", verticalAlign: "-0.05em", alignItems: "center", justifyContent: "center", fontSize: "inherit", lineHeight: "1" },
                        ".chat-heading-line": { paddingTop: "0.5em" },
                        ".chat-bold": { fontWeight: "700" },
                        ".chat-italic": { fontStyle: "italic" },
                        ".chat-strike": { textDecoration: "line-through" },
                        ".chat-header": { fontSize: "1.15em", fontWeight: "700" },
                        "@media (min-width: 1024px)": {
                            ".cm-content": { minHeight: "36px", padding: "8px 0" },
                            ".cm-scroller": { fontSize: "14px", lineHeight: "20px", maxHeight: "156px" },
                        },
                    }),
                ],
            }),
        })
        view.scrollDOM.setAttribute("data-composer-scroll", "")
        editor.current = view
        inputRef.current = view.contentDOM
        return () => { inputRef.current = null; editor.current = null; view.destroy() }
    }, [inputRef])
    useLayoutEffect(() => {
        const view = editor.current
        if (!view) return
        if (view.state.doc.toString() !== value) {
            // Sending, switching chats, and opening an edit start a new undo
            // history; undo must never bring another conversation's draft back.
            view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value }, selection: { anchor: value.length }, annotations: [externalChange.of(true), Transaction.addToHistory.of(false)], effects: historyConfig.current.reconfigure([]) })
            view.dispatch({ effects: historyConfig.current.reconfigure(history()) })
        }
        view.dispatch({ effects: placeholderConfig.current.reconfigure(editorPlaceholder(placeholder)) })
    }, [value, disabled, placeholder])
    return <><div ref={host} className={`min-w-0 flex-1 ${portal ? "px-2.5" : ""}`} data-chat-composer-host />{mentionMenu && !disabled && mentionPeople ? <ComposerMentionPicker anchor={mentionMenu.anchor} people={matchingMentionPeople(mentionPeople, mentionMenu.query)} active={mentionMenu.active} onSelect={selectMention} onDismiss={() => updateMenu(null)} /> : null}</>
}
