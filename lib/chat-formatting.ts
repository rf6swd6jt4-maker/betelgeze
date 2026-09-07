export function chatListLine(line: string) {
    const match = /^( *)(-|\d{1,9}\.|\[[ xX]\]) +(.*)$/.exec(line)
    return match ? { indent: match[1].length, marker: match[2], text: match[3], prefixLength: line.length - match[3].length } : null
}

export type ChatInline = { kind: "text"; text: string } | { kind: "link"; text: string } | { kind: "bold" | "italic" | "strike" | "header"; children: ChatInline[] }

export function parseChatInline(text: string, depth = 0): ChatInline[] {
    if (depth > 12) return [{ kind: "text", text }]
    const tokens: ChatInline[] = []
    const pattern = /https?:\/\/[^\s<>)]+|\*\*|__|~~|##/g
    let offset = 0
    let match: RegExpExecArray | null
    while ((match = pattern.exec(text))) {
        const token = match[0]
        if (token.startsWith("http")) {
            if (match.index > offset) tokens.push({ kind: "text", text: text.slice(offset, match.index) })
            tokens.push({ kind: "link", text: token })
            offset = pattern.lastIndex
            continue
        }
        const end = text.indexOf(token, pattern.lastIndex)
        if (end <= pattern.lastIndex) continue
        if (match.index > offset) tokens.push({ kind: "text", text: text.slice(offset, match.index) })
        tokens.push({ kind: token === "**" ? "bold" : token === "__" ? "italic" : token === "##" ? "header" : "strike", children: parseChatInline(text.slice(pattern.lastIndex, end), depth + 1) })
        offset = end + token.length
        pattern.lastIndex = offset
    }
    if (offset < text.length) tokens.push({ kind: "text", text: text.slice(offset) })
    return tokens
}

export function chatListEdit(value: string, start: number, end: number, key: "Enter" | "Tab", outdent = false) {
    const lineStart = start === 0 ? 0 : value.lastIndexOf("\n", start - 1) + 1
    const nextNewline = value.indexOf("\n", start)
    const lineEnd = nextNewline < 0 ? value.length : nextNewline
    const line = chatListLine(value.slice(lineStart, lineEnd))
    if (!line || end > lineEnd) return null
    if (key === "Tab") {
        const remove = outdent ? Math.min(2, line.indent) : 0
        const insert = outdent ? "" : "  "
        return { value: value.slice(0, lineStart) + insert + value.slice(lineStart + remove), start: Math.max(lineStart, start + insert.length - remove), end: Math.max(lineStart, end + insert.length - remove) }
    }
    if (start < lineStart + line.prefixLength) return null
    if (!line.text.trim()) {
        return { value: value.slice(0, lineStart) + value.slice(lineEnd), start: lineStart, end: lineStart }
    }
    const marker = line.marker.startsWith("[") ? "[ ]" : line.marker === "-" ? "-" : `${Number.parseInt(line.marker, 10) + 1}.`
    const insert = `\n${" ".repeat(line.indent)}${marker} `
    const caret = start + insert.length
    return { value: value.slice(0, start) + insert + value.slice(end), start: caret, end: caret }
}

export function chatCheckboxBody(body: string, lineIndex: number, checked: boolean) {
    const lines = body.split("\n")
    const item = chatListLine(lines[lineIndex] ?? "")
    if (!item?.marker.startsWith("[") || !item.text.trim()) return null
    lines[lineIndex] = lines[lineIndex].replace(/^( *)\[[ xX]\]/, `$1[${checked ? "x" : " "}]`)
    return lines.join("\n")
}

// Checkbox state is the only text a participant may change. A stale edit to
// the checklist wording or line structure must never toggle a different item.
export function sameChatChecklist(left: string, right: string) {
    const normalize = (body: string) => body.replace(/^( *)\[[ xX]\](?= +)/gm, "$1[ ]")
    return normalize(left) === normalize(right)
}

export type ChatDecoration = { from: number; to: number; className: string }
export function chatComposerDecorations(body: string): ChatDecoration[] {
    const decorations: ChatDecoration[] = []
    let lineStart = 0
    for (const line of body.split("\n")) {
        const item = chatListLine(line)
        if (item) {
            decorations.push({ from: lineStart + item.indent, to: lineStart + item.prefixLength, className: "chat-syntax" })
            if (/^\[[xX]\]$/.test(item.marker) && item.text) decorations.push({ from: lineStart + item.prefixLength, to: lineStart + line.length, className: "chat-strike" })
        }
        function walk(tokens: ChatInline[], offset: number) {
            for (const token of tokens) {
                if (token.kind === "text" || token.kind === "link") { offset += token.text.length; continue }
                const start = offset
                decorations.push({ from: start, to: start + 2, className: "chat-syntax" })
                offset = walk(token.children, start + 2)
                decorations.push({ from: start, to: offset + 2, className: `chat-${token.kind}` })
                decorations.push({ from: offset, to: offset + 2, className: "chat-syntax" })
                offset += 2
            }
            return offset
        }
        walk(parseChatInline(line), lineStart)
        lineStart += line.length + 1
    }
    return decorations
}
