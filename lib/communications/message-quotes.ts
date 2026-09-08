import { chatListLine, parseChatInline, type ChatInline } from "@/lib/chat-formatting"

export type MessageQuote = { text: string; start: number; end: number }

function inlineText(tokens: ChatInline[]): string {
    return tokens.map((token) => "text" in token ? token.text : inlineText(token.children)).join("")
}

/** UTF-16 offsets in visible message text, excluding formatting and list controls. */
export function chatTextLines(body: string) {
    let start = 0
    return body.split("\n").map((line) => {
        const tokens = parseChatInline(chatListLine(line)?.text ?? line)
        const text = inlineText(tokens)
        const result = { tokens, text, start }
        start += text.length + 1
        return result
    })
}

export function chatQuoteText(body: string) { return chatTextLines(body).map((line) => line.text).join("\n") }

export function messageQuoteFromValue(value: unknown): MessageQuote | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null
    const { text, start, end } = value as Record<string, unknown>
    if (typeof text !== "string" || !text.trim() || text.length > 8000 || typeof start !== "number" || typeof end !== "number"
        || !Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > 8000 || end - start !== text.length) return null
    return { text, start, end }
}

export function messageQuoteMatches(body: string, quote: MessageQuote) {
    return chatQuoteText(body).slice(quote.start, quote.end) === quote.text
}

/** Relocate after an edit only when there is one unambiguous matching passage. */
export function resolveMessageQuote(body: string, quote: MessageQuote): MessageQuote | null {
    const text = chatQuoteText(body)
    if (text.slice(quote.start, quote.end) === quote.text) return quote
    const start = text.indexOf(quote.text)
    if (start < 0 || text.indexOf(quote.text, start + 1) >= 0) return null
    return { text: quote.text, start, end: start + quote.text.length }
}

/** Read only the annotated body runs; names, reply previews and controls cannot be quoted. */
export function selectedMessageQuote(root: HTMLElement, body: string): MessageQuote | null {
    const selection = root.ownerDocument.getSelection()
    if (!selection || selection.isCollapsed || selection.rangeCount !== 1) return null
    const range = selection.getRangeAt(0)
    if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null
    const runs = Array.from(root.querySelectorAll<HTMLElement>("[data-chat-text-start]"))
    let start: number | null = null
    let end: number | null = null
    for (const run of runs) {
        if (!range.intersectsNode(run)) continue
        const offset = Number(run.dataset.chatTextStart)
        const runRange = root.ownerDocument.createRange()
        runRange.selectNodeContents(run)
        if (run.contains(range.startContainer)) runRange.setStart(range.startContainer, range.startOffset)
        if (run.contains(range.endContainer)) runRange.setEnd(range.endContainer, range.endOffset)
        if (runRange.collapsed) continue
        const before = root.ownerDocument.createRange()
        before.selectNodeContents(run)
        before.setEnd(runRange.startContainer, runRange.startOffset)
        const from = offset + before.toString().length
        start ??= from
        end = from + runRange.toString().length
    }
    if (start === null || end === null) return null
    const visible = chatQuoteText(body)
    // Native word selection can include trailing spaces. Keep the meaningful passage.
    while (start < end && /\s/.test(visible[start])) start++
    while (end > start && /\s/.test(visible[end - 1])) end--
    return messageQuoteFromValue({ text: visible.slice(start, end), start, end })
}
