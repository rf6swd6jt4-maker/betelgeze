export type MentionPerson = { id: string; name: string; avatarSrc?: string | null }
export const CHAT_MENTION_PATTERN = String.raw`@\[[^\]\n]+\]\(mention:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\)`

export function readChatMention(source: string) {
    if (!new RegExp(`^${CHAT_MENTION_PATTERN}$`, "i").test(source)) return null
    const split = source.toLowerCase().lastIndexOf("](mention:")
    try {
        const name = decodeURIComponent(source.slice(2, split))
        if (!name.trim() || /[\r\n]/.test(name) || name.length > 160) return null
        return { text: `@${name}`, userId: source.slice(split + 10, -1).toLowerCase(), source }
    } catch { return null }
}

export function chatMentionSource(person: MentionPerson) {
    const name = encodeURIComponent(person.name.replace(/[\r\n]/g, " ").trim().slice(0, 160)).replace(/[!'()*_~]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)
    return `@[${name}](mention:${person.id.toLowerCase()})`
}

export function chatMentions(body: string) {
    return [...body.matchAll(new RegExp(CHAT_MENTION_PATTERN, "gi"))].flatMap((match) => {
        const mention = readChatMention(match[0])
        return mention ? [{ ...mention, from: match.index, to: match.index + match[0].length }] : []
    })
}

export function mentionPreview(body: string) {
    return body.replace(new RegExp(CHAT_MENTION_PATTERN, "gi"), (source) => readChatMention(source)?.text ?? source)
}

export function mentionQuery(body: string, from: number, to = from) {
    if (from !== to || chatMentions(body).some((mention) => from > mention.from && from <= mention.to)) return null
    const match = /(?:^|[\s(])@([^@\n\r]{0,80})$/.exec(body.slice(0, from))
    if (!match) return null
    const start = from - match[1].length - 1
    if (chatMentions(body).some((mention) => start >= mention.from && start < mention.to)) return null
    return { from: start, to: from, query: match[1] }
}

export function matchingMentionPeople(people: MentionPerson[], query: string) {
    const words = query.toLocaleLowerCase().trim().split(/\s+/)
    return people.filter((person) => words.every((word) => person.name.toLocaleLowerCase().includes(word)))
}

export function mentionedRecipients(body: string, participantIds: string[], senderId: string) {
    const participants = new Set(participantIds)
    return [...new Set(chatMentions(body).map((mention) => mention.userId))].filter((id) => id !== senderId && participants.has(id))
}

export function chatListLine(line: string) {
    const match = /^( *)(-|\d{1,9}\.|\[[ xX]\]) +(.*)$/.exec(line)
    return match ? { indent: match[1].length, marker: match[2], text: match[3], prefixLength: line.length - match[3].length } : null
}

export type ChatInline = { kind: "mention"; text: string; userId: string; source: string } | { kind: "text"; text: string } | { kind: "link"; text: string } | { kind: "bold" | "italic" | "strike" | "header"; children: ChatInline[] }

export function parseChatInline(text: string, depth = 0): ChatInline[] {
    if (depth > 12) return [{ kind: "text", text }]
    const tokens: ChatInline[] = []
    const pattern = new RegExp(`${CHAT_MENTION_PATTERN}|https?:\\/\\/[^\\s<>)]+|\\*\\*|__|~~|##`, "gi")
    let offset = 0
    let match: RegExpExecArray | null
    while ((match = pattern.exec(text))) {
        const token = match[0]
        if (token.startsWith("@[")) {
            const mention = readChatMention(token)
            if (!mention) continue
            if (match.index > offset) tokens.push({ kind: "text", text: text.slice(offset, match.index) })
            tokens.push({ kind: "mention", ...mention })
            offset = pattern.lastIndex
            continue
        }
        if (token.toLowerCase().startsWith("http")) {
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
            if (/^\[[xX]\]$/.test(item.marker) && item.text) decorations.push({ from: lineStart + item.prefixLength, to: lineStart + line.length, className: "chat-strike" })
        }
        function walk(tokens: ChatInline[], offset: number) {
            for (const token of tokens) {
                if (token.kind === "mention") { offset += token.source.length; continue }
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

export function chatLineStartsWithHeader(line: string) {
    return parseChatInline(line.trimStart())[0]?.kind === "header"
}

export function chatComposerListMarkers(body: string) {
    const markers: { from: number; to: number; marker: string; indent: number; width: number }[] = []
    let offset = 0
    for (const line of body.split("\n")) {
        const item = chatListLine(line)
        if (item) markers.push({ from: offset, to: offset + item.prefixLength, marker: item.marker, indent: item.indent, width: Math.max(1.5, item.marker.startsWith("[") ? 1.5 : item.marker.length * 0.65 + 0.5) })
        offset += line.length + 1
    }
    return markers
}
