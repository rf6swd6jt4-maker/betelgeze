import type { GhlCalendarState } from "./ghl-calendar"

export const CALENDAR_MAX_AGE_MS = 5 * 60_000
export const CALENDAR_READ_INTERVAL_MS = 60_000

/** A complete empty range is different from a never-loaded or expired range. */
export function calendarNeedsRefresh(state: GhlCalendarState | null | undefined, now = Date.now()) {
    if (state?.busy) return false
    const checked = state?.refreshedAt ? Date.parse(state.refreshedAt) : NaN
    return !state?.snapshot || state.complete === false || !Number.isFinite(checked) || now - checked >= CALENDAR_MAX_AGE_MS
}
