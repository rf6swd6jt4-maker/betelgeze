import { Fragment, useRef, useState, type ReactNode } from "react"
import { chatListLine, parseChatInline, type ChatInline } from "@/lib/chat-formatting"

export function ChatMessageText({ body, className = "leading-5", linkClassName = "underline decoration-current/40 underline-offset-2 hover:decoration-current", onToggleCheckbox }: { body: string; className?: string; linkClassName?: string; onToggleCheckbox?: (line: number, checked: boolean) => Promise<void> }) {
    const [pending, setPending] = useState(false)
    const busy = useRef(false)
    const [error, setError] = useState<string | null>(null)
    async function toggle(line: number, checked: boolean) {
        if (!onToggleCheckbox || busy.current) return
        busy.current = true
        setPending(true)
        setError(null)
        try { await onToggleCheckbox(line, checked) }
        catch (error) { setError(error instanceof Error ? error.message : "Could not update checkbox. Try again.") }
        finally { busy.current = false; setPending(false) }
    }
    function inline(tokens: ChatInline[]): ReactNode {
        return tokens.map((token, index) => {
            if (token.kind === "text") return <Fragment key={index}>{token.text}</Fragment>
            if (token.kind === "link") return <a key={index} href={token.text} target="_blank" rel="noreferrer" className={linkClassName}>{token.text}</a>
            const Tag = token.kind === "bold" ? "strong" : token.kind === "italic" ? "em" : token.kind === "header" ? "span" : "s"
            return <Tag key={index} className={token.kind === "header" ? "text-[1.15em] font-bold" : undefined}>{inline(token.children)}</Tag>
        })
    }
    const lines = body.split("\n")
    let cursor = 0
    function list(indent: number, kind: "ordered" | "bullet" | "checkbox"): ReactNode {
        const first = chatListLine(lines[cursor])!
        const items: ReactNode[] = []
        while (cursor < lines.length) {
            const item = chatListLine(lines[cursor])
            if (!item || item.indent !== indent || listKind(item.marker) !== kind) break
            const key = cursor++
            const children: ReactNode[] = []
            while (cursor < lines.length) {
                const child = chatListLine(lines[cursor])
                if (!child || child.indent <= indent) break
                children.push(list(child.indent, listKind(child.marker)))
            }
            const checked = /^\[[xX]\]$/.test(item.marker)
            items.push(<li key={key} value={kind === "ordered" ? Number.parseInt(item.marker, 10) : undefined}>
                {kind === "checkbox" ? <div className="flex items-start gap-1.5"><button
                    type="button" role="checkbox" aria-checked={checked} aria-label={item.text || "Checklist item"}
                    disabled={!onToggleCheckbox || pending || !item.text.trim()}
                    data-message-control
                    onClick={() => void toggle(key, !checked)}
                    className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-current disabled:cursor-default disabled:opacity-60"
                ><span className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-[3px] border border-current text-[11px] leading-none">{checked ? "✓" : ""}</span></button><span className={checked ? "min-w-0 line-through opacity-70" : "min-w-0"}>{inline(parseChatInline(item.text))}</span></div> : inline(parseChatInline(item.text))}
                {children}
            </li>)
        }
        return kind === "ordered" ? <ol key={`list-${cursor}`} start={Number.parseInt(first.marker, 10)} className="list-outside list-decimal pl-5">{items}</ol> : <ul key={`list-${cursor}`} className={kind === "checkbox" ? "list-none pl-0 [&_ul]:pl-5 [&_ol]:pl-5" : "list-outside list-disc pl-5"}>{items}</ul>
    }
    const blocks: ReactNode[] = []
    while (cursor < lines.length) {
        const item = chatListLine(lines[cursor])
        if (item) blocks.push(list(item.indent, listKind(item.marker)))
        else {
            const key = cursor
            blocks.push(<div key={key}>{lines[cursor] ? inline(parseChatInline(lines[cursor])) : <br />}</div>)
            cursor++
        }
    }
    return <div className={`whitespace-pre-wrap break-words ${className}`}>{blocks}{error ? <p role="alert" className="mt-1 text-xs">{error}</p> : null}</div>
}
function listKind(marker: string) { return marker === "-" ? "bullet" : marker.startsWith("[") ? "checkbox" : "ordered" }
