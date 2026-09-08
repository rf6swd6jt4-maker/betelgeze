"use client"

import { useEffect, useState, type RefObject } from "react"
import { selectedMessageQuote, type MessageQuote } from "@/lib/communications/message-quotes"

export function MessageQuoteSelection({ messageId, body, paneRef, onConfirm, onCancel }: {
    messageId: string
    body: string
    paneRef: RefObject<HTMLDivElement | null>
    onConfirm: (quote: MessageQuote) => void
    onCancel: () => void
}) {
    const [quote, setQuote] = useState<MessageQuote | null>(null)
    useEffect(() => {
        const root = paneRef.current?.querySelector<HTMLElement>(`[data-message-interaction="${CSS.escape(messageId)}"] [data-chat-message-text]`)
        if (!root) return
        const doc = root.ownerDocument
        doc.getSelection()?.removeAllRanges()
        root.focus({ preventScroll: true })
        const update = () => setQuote(selectedMessageQuote(root, body))
        const keydown = (event: KeyboardEvent) => {
            if (event.key === "Escape") { event.preventDefault(); onCancel(); return }
            if (event.target !== root) return
            const selection = doc.getSelection()
            if (!selection) return
            if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "a") {
                event.preventDefault()
                const range = doc.createRange()
                range.selectNodeContents(root)
                selection.removeAllRanges()
                selection.addRange(range)
            } else if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
                event.preventDefault()
                if (!selection.anchorNode || !root.contains(selection.anchorNode)) {
                    const first = root.querySelector("[data-chat-text-start]")?.firstChild
                    if (first) selection.collapse(first, 0)
                }
                selection.modify(event.shiftKey ? "extend" : "move", event.key === "ArrowLeft" || event.key === "ArrowUp" ? "backward" : "forward", event.key === "ArrowUp" || event.key === "ArrowDown" ? "line" : event.ctrlKey || event.altKey ? "word" : "character")
            }
        }
        doc.addEventListener("selectionchange", update)
        doc.addEventListener("keydown", keydown)
        return () => {
            doc.removeEventListener("selectionchange", update)
            doc.removeEventListener("keydown", keydown)
            doc.getSelection()?.removeAllRanges()
        }
    }, [body, messageId, onCancel, paneRef])
    return <div className="mx-auto flex max-w-3xl items-center gap-3 text-xs" data-message-control>
        <span className="min-w-0 flex-1" role="status">{quote ? <span className="line-clamp-2 whitespace-pre-wrap">“{quote.text}”</span> : "Highlight the text you want to quote."}</span>
        <button type="button" onPointerDown={(event) => event.preventDefault()} onClick={onCancel} className="shrink-0 px-2 py-2 text-neutral-400 hover:text-white">Cancel</button>
        <button type="button" onPointerDown={(event) => event.preventDefault()} disabled={!quote} onClick={() => { if (quote) onConfirm(quote) }} className="shrink-0 rounded-lg bg-white px-3 py-2 font-semibold text-black disabled:opacity-30">Quote selection</button>
    </div>
}
