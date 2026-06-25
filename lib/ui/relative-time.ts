export function formatRelativeTime(value: string | null | undefined) {
    if (!value) return "—"
    const then = new Date(value).getTime()
    if (!Number.isFinite(then)) return "—"
    const diffSeconds = Math.max(0, Math.floor((Date.now() - then) / 1000))
    if (diffSeconds < 60) return `${diffSeconds}s ago`
    const diffMinutes = Math.floor(diffSeconds / 60)
    if (diffMinutes < 60) return `${diffMinutes}m ago`
    const diffHours = Math.floor(diffMinutes / 60)
    if (diffHours < 24) return `${diffHours}h ago`
    if (diffHours < 48) return "Yesterday"
    const diffDays = Math.floor(diffHours / 24)
    if (diffDays < 7) return `${diffDays}d ago`
    return new Date(value).toLocaleDateString("en-IE", { day: "numeric", month: "short", year: "numeric" })
}

export function shortId(value: string | null | undefined, length = 7) {
    if (!value) return "—"
    return value.slice(0, length)
}

export function compactText(value: string | null | undefined, length = 180) {
    if (!value) return null
    return value.length > length ? `${value.slice(0, length)}…` : value
}
