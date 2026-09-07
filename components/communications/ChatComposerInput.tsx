"use client"

import { useLayoutEffect, useRef, type RefObject } from "react"
import { Annotation, Compartment, EditorState, StateField, Transaction } from "@codemirror/state"
import { Decoration, EditorView, keymap, placeholder as editorPlaceholder } from "@codemirror/view"
import { defaultKeymap, history, historyKeymap, insertNewline } from "@codemirror/commands"
import { chatComposerDecorations, chatListEdit } from "@/lib/chat-formatting"

const externalChange = Annotation.define<boolean>()
const formatting = StateField.define({
    create: (state) => decorate(state.doc.toString()),
    update: (value, transaction) => transaction.docChanged ? decorate(transaction.newDoc.toString()) : value,
    provide: (field) => EditorView.decorations.from(field),
})
function decorate(body: string) {
    return Decoration.set(chatComposerDecorations(body).map(({ from, to, className }) => Decoration.mark({ class: className }).range(from, to)), true)
}

export function ChatComposerInput({ inputRef, value, onChange, onSend, onFocus, onBlur, disabled = false, sendDisabled = false, placeholder, maxLength = 8000, portal = false }: {
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
    const historyConfig = useRef(new Compartment())
    const placeholderConfig = useRef(new Compartment())
    const current = useRef({ value, onChange, onSend, onFocus, onBlur, disabled, sendDisabled, placeholder, maxLength })
    useLayoutEffect(() => { current.current = { value, onChange, onSend, onFocus, onBlur, disabled, sendDisabled, placeholder, maxLength } })
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
        const enter = (view: EditorView) => {
            if (view.composing || current.current.disabled) return false
            if (editList(view, "Enter")) return true
            if (!current.current.sendDisabled) current.current.onSend()
            return true
        }
        const view = new EditorView({
            parent: host.current,
            state: EditorState.create({
                doc: current.current.value,
                extensions: [
                    formatting, historyConfig.current.of(history()), EditorView.lineWrapping,
                    keymap.of([
                        { key: "Enter", run: enter, shift: insertNewline },
                        { key: "Tab", run: (view) => editList(view, "Tab"), shift: (view) => editList(view, "Tab", true) },
                        ...historyKeymap, ...defaultKeymap,
                    ]),
                    EditorView.inputHandler.of((view, from, to, text) => {
                        if (text !== "\n" || view.composing) return false
                        if (from !== view.state.selection.main.from || to !== view.state.selection.main.to) return false
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
                        if (update.docChanged && !update.transactions.some((transaction) => transaction.annotation(externalChange))) current.current.onChange(update.state.doc.toString())
                    }),
                    EditorView.domEventHandlers({
                        focus: () => { current.current.onFocus?.() },
                        blur: () => { current.current.onBlur?.() },
                        pointerdown: (_event, view) => { if (!view.hasFocus && !current.current.disabled) view.contentDOM.focus({ preventScroll: true }) },
                    }),
                    // Size the scroller directly: its default 1.4 line-height
                    // overrides editor inheritance, and a bare "&" inside this
                    // theme's media rule is omitted by the style generator.
                    // Symmetric padding + one line exactly fills the control.
                    EditorView.theme({
                        "&": { backgroundColor: "transparent", color: "inherit" },
                        "&.cm-focused": { outline: "none" },
                        ".cm-scroller": { fontFamily: "inherit", fontSize: "16px", lineHeight: "24px", maxHeight: "116px", overflow: "auto", overscrollBehavior: "contain" },
                        ".cm-content": { boxSizing: "border-box", padding: "10px 0", caretColor: "currentColor", minHeight: "44px" },
                        ".cm-line": { padding: "0" },
                        ".cm-placeholder": { color: "inherit", opacity: "0.4" },
                        ".chat-syntax": { opacity: "0.35" },
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
    return <div ref={host} className={`min-w-0 flex-1 ${portal ? "px-2.5" : ""}`} data-chat-composer-host />
}
