import { Fragment, type ReactNode } from "react"
import { chatListLine, parseChatInline, type ChatInline } from "@/lib/chat-formatting"

export function ChatMessageText({ body, className = "leading-5", linkClassName = "underline decoration-current/40 underline-offset-2 hover:decoration-current" }: { body: string; className?: string; linkClassName?: string }) {
    function inline(tokens: ChatInline[]): ReactNode {
        return tokens.map((token, index) => {
            if (token.kind === "text") return <Fragment key={index}>{token.text}</Fragment>
            if (token.kind === "link") return <a key={index} href={token.text} target="_blank" rel="noreferrer" className={linkClassName}>{token.text}</a>
            const Tag = token.kind === "bold" ? "strong" : token.kind === "italic" ? "em" : "s"
            return <Tag key={index}>{inline(token.children)}</Tag>
        })
    }
    const lines = body.split("\n")
    let cursor = 0
    function list(indent: number, ordered: boolean): ReactNode {
        const first = chatListLine(lines[cursor])!
        const items: ReactNode[] = []
        while (cursor < lines.length) {
            const item = chatListLine(lines[cursor])
            if (!item || item.indent !== indent || (item.marker !== "-") !== ordered) break
            const key = cursor++
            const children: ReactNode[] = []
            while (cursor < lines.length) {
                const child = chatListLine(lines[cursor])
                if (!child || child.indent <= indent) break
                children.push(list(child.indent, child.marker !== "-"))
            }
            items.push(<li key={key} value={ordered ? Number.parseInt(item.marker, 10) : undefined}>{inline(parseChatInline(item.text))}{children}</li>)
        }
        return ordered ? <ol key={`list-${cursor}`} start={Number.parseInt(first.marker, 10)} className="list-outside list-decimal pl-5">{items}</ol> : <ul key={`list-${cursor}`} className="list-outside list-disc pl-5">{items}</ul>
    }
    const blocks: ReactNode[] = []
    while (cursor < lines.length) {
        const item = chatListLine(lines[cursor])
        if (item) blocks.push(list(item.indent, item.marker !== "-"))
        else {
            const key = cursor
            blocks.push(<div key={key}>{lines[cursor] ? inline(parseChatInline(lines[cursor])) : <br />}</div>)
            cursor++
        }
    }
    return <div className={`whitespace-pre-wrap break-words ${className}`}>{blocks}</div>
}
