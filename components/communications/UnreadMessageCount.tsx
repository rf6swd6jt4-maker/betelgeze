export function UnreadMessageCount({ count, label, loading = false }: { count?: number; label: string; loading?: boolean }) {
    if (!loading && (count === undefined || count <= 0)) return null
    // This is unread navigation state for one destination, not an operational
    // status or grouped statistic that the shared StatusStat primitive represents.
    const display = loading ? "…" : count! > 99 ? "99+" : count
    return <span aria-label={loading ? `Loading ${label}` : `${display} ${label}`} className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-white px-1 text-[10px] font-bold tabular-nums text-black">{display}</span>
}
