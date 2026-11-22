import assert from "node:assert/strict"
import test from "node:test"
import { bookingDays, zonedTime, type BookingRules } from "../lib/campaigns/slots.ts"
import { campaignsPilotEnabled } from "../lib/campaigns/pilot.ts"
import { bookingSlugFrom, formatAppointment, formatMoney, originOf } from "../lib/campaigns/model.ts"

const rules: BookingRules = { time_zone: "America/Chicago", booking_days: [1, 2, 3, 4, 5], day_start_minute: 540, day_end_minute: 1020, meeting_minutes: 60, notice_hours: 12, horizon_days: 7 }

test("wall-clock times convert in the source's zone, across daylight saving", () => {
    assert.equal(zonedTime(2026, 11, 24, 600, "America/Chicago").toISOString(), "2026-11-24T16:00:00.000Z")
    assert.equal(zonedTime(2026, 7, 14, 600, "America/Chicago").toISOString(), "2026-07-14T15:00:00.000Z")
    assert.equal(zonedTime(2026, 11, 24, 600, "America/Phoenix").toISOString(), "2026-11-24T17:00:00.000Z")
})

test("only weekday hours, after the notice and within the horizon, are offered", () => {
    // Sunday 22 Nov 2026, 10:00 CT. First open day is Monday; Sunday and Saturday are closed.
    const now = new Date("2026-11-22T16:00:00Z")
    const days = bookingDays(rules, now)
    assert.equal(days[0].date, "2026-11-23")
    assert.ok(days.every(day => !["Sat", "Sun"].includes(day.weekday)))
    assert.deepEqual(days[0].slots.map(slot => slot.label), ["9:00 AM", "10:00 AM", "11:00 AM", "12:00 PM", "1:00 PM", "2:00 PM", "3:00 PM", "4:00 PM"])
    assert.ok(days.at(-1)!.date <= "2026-11-29")
    // 12 hours' notice from 10:00 CT Sunday means nothing before 22:00 Sunday, so Monday 9:00 is the first time.
    assert.equal(days[0].slots[0].iso, "2026-11-23T15:00:00.000Z")
})

test("taken times are left out, and notice can push a day's first times away", () => {
    const now = new Date("2026-11-23T14:30:00Z") // Monday 8:30 CT
    const days = bookingDays({ ...rules, notice_hours: 2 }, now, ["2026-11-23T18:00:00.000Z"])
    assert.equal(days[0].date, "2026-11-23")
    assert.deepEqual(days[0].slots.map(slot => slot.label), ["11:00 AM", "1:00 PM", "2:00 PM", "3:00 PM", "4:00 PM"])
})

test("the pilot is off unless the person is listed", () => {
    assert.equal(campaignsPilotEnabled("a", undefined), false)
    assert.equal(campaignsPilotEnabled("a", ""), false)
    assert.equal(campaignsPilotEnabled("a", "b, a"), true)
    assert.equal(campaignsPilotEnabled("c", "b, a"), false)
    assert.equal(campaignsPilotEnabled("c", "all"), true)
    assert.equal(campaignsPilotEnabled(null, "all"), false)
})

test("display helpers", () => {
    assert.equal(formatMoney(29700), "$297")
    assert.equal(formatMoney(100), "$1")
    assert.equal(formatMoney(150), "$1.50")
    assert.equal(formatAppointment("2026-11-24T16:00:00.000Z", "America/Chicago"), "Tue, Nov 24, 10:00 AM CT")
    assert.equal(bookingSlugFrom("Funnel teardown"), "funnel-teardown")
    assert.equal(bookingSlugFrom("A"), "a-call")
    assert.equal(originOf("https://Scaylup.com/teardown/"), "https://scaylup.com")
    assert.equal(originOf("http://scaylup.com"), null)
})
