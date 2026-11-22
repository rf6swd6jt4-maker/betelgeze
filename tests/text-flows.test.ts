import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import {
    fillFlowText, flowFields, flowWarnings, leadTimeZone, nextMorning, nextSendingTime, parseFlowReplies, parseFlowSteps, smsSegments, waitUntil, zonedInstant,
    type FlowSettings,
} from "../lib/campaigns/flows.ts"

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
const flow = (over: Partial<FlowSettings> = {}): FlowSettings => ({
    id: "f", name: "Instant reply", enabled: false, trigger: "new", triggerStage: null, sourceIds: null, stopOnReply: true, stopOnBook: true, stopOnPay: false,
    windowStart: 480, windowEnd: 1200, windowDays: "every", replies: [], steps: [{ id: "s1", kind: "text", body: "Hi {first_name}: {booking_link}", image: null }], ...over,
})
const sources = [{ id: "td", tag: "Teardown", pays: true, books: true }, { id: "bk", tag: "Bookings", pays: false, books: true }]

test("segments count GSM-7 at 160/153 and emoji or curly quotes at 70/67", () => {
    assert.deepEqual(smsSegments("a".repeat(160)), { length: 160, segments: 1, gsm: true })
    assert.deepEqual(smsSegments("a".repeat(161)), { length: 161, segments: 2, gsm: true })
    assert.equal(smsSegments("€").length, 2, "extension characters count twice")
    assert.deepEqual(smsSegments("It’s here"), { length: 9, segments: 1, gsm: false })
    assert.equal(smsSegments("🙂".repeat(71)).segments, 2)
})

test("fields fill in, and a missing or unknown field stays visible", () => {
    assert.equal(fillFlowText("Hi {first_name}, {booking_link}", { first_name: "Marcus", booking_link: "https://x/book/td" }), "Hi Marcus, https://x/book/td")
    assert.equal(fillFlowText("{first_name} {nope} {hold_until}", { first_name: "Dana" }), "Dana {nope} {hold_until}")
    assert.deepEqual(flowFields({ trigger: "hold", triggerStage: null }), ["first_name", "business", "setter_first_name", "booking_link", "appointment_time", "hold_until", "payment_link"])
    assert.ok(flowFields({ trigger: "booked", triggerStage: null }).includes("meeting_details"))
    assert.ok(!flowFields({ trigger: "new", triggerStage: null }).includes("appointment_time"))
})

test("warnings block switching on a flow that would send something wrong", () => {
    assert.deepEqual(flowWarnings(flow(), sources), [])
    assert.deepEqual(flowWarnings(flow({ steps: [{ id: "s1", kind: "text", body: "Held until {hold_until}", image: null }, { id: "s2", kind: "wait", mode: "before", amount: 24, unit: "hours" }] }), sources), [
        "Step 1 uses {hold_until}, which leads don't have when this flow starts.",
        "Step 2 waits for the appointment, but this flow doesn't start with a booking.",
    ])
    assert.deepEqual(flowWarnings(flow({ steps: [] }), sources), ["This flow sends no texts yet."])
    assert.deepEqual(flowWarnings(flow({ trigger: "hold", sourceIds: ["bk"] }), sources), ["None of the picked sources takes payment, so nobody holds a time."])
    assert.deepEqual(flowWarnings(flow({ steps: [{ id: "s1", kind: "text", body: "{nope}", image: null }] }), sources), ["Step 1 uses {nope}, which isn't a field."])
    assert.ok(flowWarnings(flow(), [{ id: "lp", tag: "Landing", pays: false, books: false }]).some(warning => warning.includes("has no booking page")))
})

test("stored steps are re-validated: bad steps, ids, amounts and reserved reply words are dropped", () => {
    const steps = parseFlowSteps([
        { id: "a", kind: "text", body: "x".repeat(2000), image: { path: "../../etc/passwd", fileName: "p", mimeType: "image/png", size: 1 } },
        { id: "a", kind: "wait" }, { id: "b", kind: "wait", mode: "for", amount: 99999, unit: "minutes" }, { id: "c", kind: "act", action: "stage", value: "booked" },
        { id: "bad id!", kind: "if" }, { kind: "text" }, { id: "d", kind: "nope" },
    ])
    assert.deepEqual(steps.map(step => step.id), ["a", "b", "c"])
    assert.equal(steps[0].kind === "text" && steps[0].body.length, 1600)
    assert.equal(steps[0].kind === "text" && steps[0].image, null, "a picture outside the flow's own storage is refused")
    assert.equal(steps[1].kind === "wait" && steps[1].amount, 1440)
    assert.equal(steps[2].kind === "act" && steps[2].value, "lost", "moving to Booked needs a booking, so it is not an action")
    assert.deepEqual(parseFlowReplies([{ word: "c", action: "confirm" }, { word: "stop", action: "stop" }, { word: "C", action: "task" }, { word: "help", action: "task" }, { word: "R", action: "x" }]), [{ word: "C", action: "confirm" }])
})

test("a lead's time zone comes from their area code, else their source's", () => {
    assert.equal(leadTimeZone("+15125550142", "America/New_York"), "America/Chicago")
    assert.equal(leadTimeZone("+12125550142", "America/Chicago"), "America/New_York")
    assert.equal(leadTimeZone("+16025550142", "America/Chicago"), "America/Phoenix")
    assert.equal(leadTimeZone("+19155550142", "America/Chicago"), "America/Denver", "El Paso is Mountain")
    assert.equal(leadTimeZone("+18505550142", "America/Chicago"), "America/Chicago", "a split code uses the source's zone")
})

test("texts wait for the sending hours and days in the lead's zone, across DST", () => {
    const window = { windowStart: 480, windowEnd: 1200, windowDays: "weekdays" as const }
    const tuesdayNoonCentral = new Date("2026-11-24T18:00:00Z")
    assert.equal(nextSendingTime(tuesdayNoonCentral, window, "America/Chicago").toISOString(), tuesdayNoonCentral.toISOString(), "inside the window: now")
    assert.equal(nextSendingTime(new Date("2026-11-24T03:30:00Z"), window, "America/Chicago").toISOString(), "2026-11-24T14:00:00.000Z", "9:30 PM Monday waits for 8:00 AM Tuesday")
    assert.equal(nextSendingTime(new Date("2026-11-28T18:00:00Z"), window, "America/Chicago").toISOString(), "2026-11-30T14:00:00.000Z", "Saturday waits for Monday")
    assert.equal(zonedInstant(2026, 3, 9, 480, "America/Chicago").toISOString(), "2026-03-09T13:00:00.000Z", "after spring forward, 8:00 AM CDT")
    assert.equal(nextMorning(new Date("2026-11-24T18:00:00Z"), "America/New_York").toISOString(), "2026-11-25T14:00:00.000Z")
    const step = { id: "w", kind: "wait" as const, mode: "before" as const, amount: 24, unit: "hours" as const }
    assert.equal(waitUntil(step, new Date(), { timeZone: "America/Chicago", startsAt: "2026-11-26T16:00:00Z", heldUntil: null }).toISOString(), "2026-11-25T16:00:00.000Z")
})

test("flows hook into every path once, and the scheduler and worker are guarded", () => {
    const migration = source("supabase/migrations/20261125010000_campaign_text_flows.sql")
    assert.match(migration, /create trigger campaign_lead_flows after insert or update of stage,sms_consent,submission_count on public\.campaign_leads/)
    assert.match(migration, /create trigger campaign_booking_flows after insert or update of status,paid_at on public\.campaign_bookings/)
    assert.match(migration, /create unique index campaign_flow_runs_one_active on public\.campaign_flow_runs\(flow_id,lead_id\) where status='active'/)
    assert.match(migration, /for update skip locked/)
    const cron = source("app/api/cron/campaign-flows/route.ts")
    assert.match(cron, /timingSafeEqual\(expected, supplied\)/)
    const webhook = source("app/api/signalhouse/webhook/[accountId]/route.ts")
    assert.match(webhook, /if \(reply\?\.fresh\) \{ await applyFlowReply/)
    const server = source("lib/campaigns/flows-server.ts")
    // A retried step sends once: its request id comes from the run and the step.
    assert.match(server, /clientRequestId: stepRequestId\(run\.id, step\.id\)/)
    assert.match(server, /nextSendingTime\(now, flow, timeZone\)/)
})
