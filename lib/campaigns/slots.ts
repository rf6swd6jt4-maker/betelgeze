/**
 * Booking times for a source, computed from its hours in its own time zone (docs/campaign-booking.md). Pure: the
 * database re-checks every chosen time with the same rules, so this only decides what the booking page offers.
 */
export type BookingRules = {
    time_zone: string
    booking_days: number[]
    day_start_minute: number
    day_end_minute: number
    meeting_minutes: number
    notice_hours: number
    horizon_days: number
}

export type BookingDay = { date: string; weekday: string; label: string; slots: { iso: string; label: string }[] }

function zoneParts(date: Date, timeZone: string) {
    const parts = new Intl.DateTimeFormat("en-US", {
        timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).formatToParts(date)
    const value = (type: string) => Number(parts.find(part => part.type === type)?.value)
    return { year: value("year"), month: value("month"), day: value("day"), hour: value("hour") % 24, minute: value("minute"), second: value("second") }
}

/** Milliseconds the zone is ahead of UTC at this instant. */
function zoneOffset(date: Date, timeZone: string) {
    const p = zoneParts(date, timeZone)
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(date.getTime() / 1000) * 1000
}

/** The instant a wall-clock time happens in a zone (the earlier one when clocks repeat, the later when they skip). */
export function zonedTime(year: number, month: number, day: number, minuteOfDay: number, timeZone: string) {
    const wall = Date.UTC(year, month - 1, day, Math.floor(minuteOfDay / 60), minuteOfDay % 60)
    let instant = wall - zoneOffset(new Date(wall), timeZone)
    instant = wall - zoneOffset(new Date(instant), timeZone)
    return new Date(instant)
}

export function bookingDays(rules: BookingRules, now: Date, taken: readonly string[] = []): BookingDay[] {
    const takenTimes = new Set(taken.map(value => new Date(value).getTime()))
    const earliest = now.getTime() + rules.notice_hours * 3_600_000
    const latest = now.getTime() + rules.horizon_days * 86_400_000
    const today = zoneParts(now, rules.time_zone)
    const days: BookingDay[] = []
    const dayLabel = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" })
    const weekdayLabel = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short" })
    const timeLabel = new Intl.DateTimeFormat("en-US", { timeZone: rules.time_zone, hour: "numeric", minute: "2-digit" })
    for (let offset = 0; offset <= rules.horizon_days; offset++) {
        const calendar = new Date(Date.UTC(today.year, today.month - 1, today.day + offset))
        if (!rules.booking_days.includes(calendar.getUTCDay())) continue
        const year = calendar.getUTCFullYear(), month = calendar.getUTCMonth() + 1, day = calendar.getUTCDate()
        const slots: BookingDay["slots"] = []
        for (let minute = rules.day_start_minute; minute + rules.meeting_minutes <= rules.day_end_minute; minute += rules.meeting_minutes) {
            const start = zonedTime(year, month, day, minute, rules.time_zone)
            // A time that a clock change moved off its wall time is not offered.
            const back = zoneParts(start, rules.time_zone)
            if (back.hour * 60 + back.minute !== minute || back.day !== day) continue
            const time = start.getTime()
            if (time < earliest || time > latest || takenTimes.has(time)) continue
            slots.push({ iso: start.toISOString(), label: timeLabel.format(start) })
        }
        if (slots.length) days.push({
            date: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
            weekday: weekdayLabel.format(calendar),
            label: dayLabel.format(calendar),
            slots,
        })
    }
    return days
}
