// Short, scannable wording for the Today column's rows. Pure: the caller supplies the clock.

const HOUR = 3_600_000
const DAY = 24 * HOUR

/** How long something has been waiting: "40m", "26h", "3d", "5w". Empty when unknown or in the future. */
export function waitingLabel(since: string | null | undefined, now: number) {
    const start = since ? Date.parse(since) : Number.NaN
    if (!Number.isFinite(start) || start > now) return ""
    const elapsed = now - start
    if (elapsed < HOUR) return `${Math.max(1, Math.floor(elapsed / 60_000))}m`
    if (elapsed < 2 * DAY) return `${Math.floor(elapsed / HOUR)}h`
    if (elapsed < 14 * DAY) return `${Math.floor(elapsed / DAY)}d`
    return `${Math.floor(elapsed / (7 * DAY))}w`
}

/** Active effort as the queue states it: "~45 min", "~1 h", "~2.5 h". Empty when there is no estimate. */
export function effortLabel(minutes: number | null | undefined) {
    if (typeof minutes !== "number" || !Number.isFinite(minutes) || minutes <= 0) return ""
    if (minutes < 60) return `~${Math.round(minutes)} min`
    const hours = Math.round(minutes / 30) / 2
    return `~${hours} h`
}

function localDay(time: number) {
    const date = new Date(time)
    return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY
}

/** A deadline relative to the person's own calendar day. `late` is true once the deadline itself has passed. */
export function dueLabel(dueAt: string | null | undefined, now: number): { label: string; late: boolean } | null {
    const due = dueAt ? Date.parse(dueAt) : Number.NaN
    if (!Number.isFinite(due)) return null
    const days = localDay(due) - localDay(now)
    const late = due < now
    if (days < -1) return { label: `Overdue ${-days}d`, late: true }
    if (days === -1) return { label: "Due yesterday", late: true }
    if (days === 0) return { label: late ? "Was due today" : "Due today", late }
    if (days === 1) return { label: "Due tomorrow", late: false }
    const date = new Date(due)
    if (days < 7) return { label: `Due ${date.toLocaleDateString(undefined, { weekday: "short" })}`, late: false }
    return { label: `Due ${date.toLocaleDateString(undefined, { day: "numeric", month: "short" })}`, late: false }
}
