"use client"

import { useEffect, type RefObject } from "react"
import { selectedMessageQuote, type MessageQuote } from "@/lib/communications/message-quotes"

export function MessageQuoteSelection({ messageId, body, paneRef, onChange, onCancel }: {
    messageId: string
    body: string
    paneRef: RefObject<HTMLDivElement | null>
    onChange: (messageId: string, quote: MessageQuote | null) => void
    onCancel: () => void
}) {
    useEffect(() => {
        const root = paneRef.current?.querySelector<HTMLElement>(`[data-message-interaction="${CSS.escape(messageId)}"] [data-chat-message-text]`)
        if (!root) return
        const doc = root.ownerDocument
        // Selection in the composer must not erase the passage already chosen.
        const update = () => {
            const selection = doc.getSelection()
            if (!selection || (!root.contains(selection.anchorNode) && !root.contains(selection.focusNode))) return
            onChange(messageId, selectedMessageQuote(root, body))
        }
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
            const selection = doc.getSelection()
            if (selection && (root.contains(selection.anchorNode) || root.contains(selection.focusNode))) selection.removeAllRanges()
        }
    }, [body, messageId, onCancel, onChange, paneRef])
    return null
}
