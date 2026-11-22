import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { bookingDays, zonedTime, type BookingRules } from "../lib/campaigns/slots.ts"
import { campaignsPilotEnabled } from "../lib/campaigns/pilot.ts"
import { bookingSlugFrom, formatAppointment, formatMoney, originOf } from "../lib/campaigns/model.ts"
import { WORKSPACE_TAB_FRAME_PARAM, workspaceTabRedirectUrl } from "../lib/workspace-tabs.ts"
import { BOOKING_FRAME_ANCESTORS, bookingEmbedReturnUrl, isBookingFrameOrigin } from "../lib/campaigns/embed.ts"

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

test("opening Campaigns in a workspace tab keeps the tab when it goes straight to the one campaign", () => {
    // A redirect without the tab's identity made the frame load a second app shell, which opened Campaigns again.
    const page = readFileSync("app/[workspaceSlug]/campaigns/page.tsx", "utf8")
    assert.match(page, /redirect\(workspaceTabRedirectUrl\(`\/\$\{workspace\.slug\}\/campaigns\/\$\{campaigns\[0\]\.id\}`, \(await headers\(\)\)\.get\("x-betelgeze-current-path"\)\)\)/)
    assert.doesNotMatch(page, /redirect\(`/)
    const target = new URL(workspaceTabRedirectUrl("/scaylup/campaigns/c1", `/scaylup/campaigns?${WORKSPACE_TAB_FRAME_PARAM}=tab-1`), "http://localhost")
    assert.equal(target.pathname, "/scaylup/campaigns/c1")
    assert.equal(target.searchParams.get(WORKSPACE_TAB_FRAME_PARAM), "tab-1")
})

test("a test lead is a valid intake submission with a fixed 555 phone per source", async () => {
    const { testLeadInput, TEST_LEAD_CONSENT } = await import("../lib/campaigns/test-lead.ts")
    const { createHash } = await import("node:crypto")
    const a = testLeadInput("source-a", "user-1"), again = testLeadInput("source-a", "user-1"), b = testLeadInput("source-b", "user-1")
    assert.match(a.phone_e164, /^\+1555\d{7}$/)
    assert.equal(a.phone_e164, again.phone_e164)
    assert.notEqual(a.phone_e164, b.phone_e164)
    assert.notEqual(a.submission_id, again.submission_id)
    assert.match(a.submission_id, /^[0-9a-f-]{36}$/)
    assert.match(a.ip_hmac, /^[a-f0-9]{64}$/)
    assert.equal(a.consent_sha256, createHash("sha256").update(TEST_LEAD_CONSENT).digest("hex"))
    assert.ok(TEST_LEAD_CONSENT.length >= 20)
})

test("a campaign, its sources and its leads name themselves in the top bar; other campaign routes do not", async () => {
    const { workspaceTabRecordTitleForUrl } = await import("../lib/workspace-tabs.ts")
    const id = "d6709b95-f45b-4592-b1f0-a5cccb4ada26"
    assert.equal(workspaceTabRecordTitleForUrl(`/scaylup/campaigns/${id}?tab=leads`, "scaylup", "Garage Door Clients"), "Garage Door Clients")
    assert.equal(workspaceTabRecordTitleForUrl(`/scaylup/campaigns/${id}/sources/${id}`, "scaylup", "Funnel teardown"), "Funnel teardown")
    assert.equal(workspaceTabRecordTitleForUrl(`/scaylup/campaigns/${id}/leads/${id}`, "scaylup", "Test Lead"), "Test Lead")
    assert.equal(workspaceTabRecordTitleForUrl("/scaylup/campaigns/new", "scaylup", "New campaign"), "")
    assert.equal(workspaceTabRecordTitleForUrl(`/other/campaigns/${id}`, "scaylup", "X"), "")
})

test("a campaign's tabs and source filter switch in place, reading leads only for the tabs that show them", () => {
    const page = readFileSync("app/[workspaceSlug]/campaigns/[campaignId]/page.tsx", "utf8")
    const sections = readFileSync("components/campaigns/CampaignSections.tsx", "utf8")
    const header = readFileSync("components/campaigns/CampaignPageHeader.tsx", "utf8")
    // Leads are read only for the tabs that show them; opened elsewhere, Pipeline or Leads reads them in the background.
    assert.match(page, /const withLeads = query\.tab !== "sources" && query\.tab !== "flows"/)
    assert.match(page, /withLeads \? loadCampaignLeads\(workspace\.id, campaignId\) : Promise\.resolve\(null\)/)
    assert.match(sections, /useLayoutEffect\(\(\) => \{ if \(needsLeads\) readLeads\(\) \}, \[needsLeads, readLeads\]\)/)
    assert.match(sections, /startRead\(\(\) => router\.refresh\(\)\)/)
    // The tabs skip the frame's navigation (and the loading screen) and push the address in place, keeping the frame's own parameters.
    assert.match(header, /data-workspace-instant-filter=\{onSelect \? "" : undefined\}/)
    assert.match(sections, /onSelect=\{select\}/)
    assert.match(sections, /new URL\(window\.location\.href\)/)
    assert.match(sections, /window\.history\.pushState\(null, "", /)
    // The source filter uses the shared instant filter.
    assert.match(sections, /instant=\{\{ param: "source", value: null \}\}/)
    assert.match(sections, /instant=\{\{ param: "source", value: entry\.id \}\}/)
})

test("an embedded booking returns from Stripe to the funnel's book.html, only on sites allowed to frame it", () => {
    assert.equal(bookingEmbedReturnUrl("https://scaylup.com/teardown/"), "https://scaylup.com/teardown/book.html")
    assert.equal(bookingEmbedReturnUrl("https://scaylup.com/teardown"), "https://scaylup.com/teardown/book.html")
    assert.equal(bookingEmbedReturnUrl("https://scaylup.com/teardown/index.html"), "https://scaylup.com/teardown/book.html")
    assert.equal(bookingEmbedReturnUrl("https://evil.example/teardown/"), null)
    assert.equal(bookingEmbedReturnUrl("http://scaylup.com/teardown/"), null)
    assert.equal(bookingEmbedReturnUrl(null), null)
    assert.equal(isBookingFrameOrigin("https://scaylup.com"), true)
    assert.equal(isBookingFrameOrigin("https://scaylup.com.evil.example"), false)
    assert.equal(BOOKING_FRAME_ANCESTORS, "frame-ancestors 'self' https://scaylup.com")
})

test("booking pages may be framed only by the app and the funnel, and embed in the funnel's look", () => {
    const config = readFileSync("next.config.ts", "utf8")
    assert.match(config, /source: "\/book\/:path\*",\s*headers: \[\{ key: "Content-Security-Policy", value: BOOKING_FRAME_ANCESTORS \}\]/)
    const startup = readFileSync("lib/app-startup.ts", "utf8")
    assert.match(startup, /get\("embed"\) === "1"/)
    assert.match(startup, /:root\[data-app-startup="embed"\] body \{ background: transparent !important; \}/)
    const page = readFileSync("app/book/[slug]/page.tsx", "utf8")
    assert.match(page, /const embed = first\(query\.embed\) === "1"/)
    assert.match(page, /target=\{embed \? "_top" : undefined\}/)
    assert.match(page, /embed \? <BookingEmbedHeight>/)
    const picker = readFileSync("components/campaigns/BookingPicker.tsx", "utf8")
    assert.match(picker, /window\.top\.location\.assign\(result\.checkout_url\)/)
    assert.match(picker, /window\.parent\.postMessage\(\{ type: BOOKING_HEIGHT_MESSAGE, height \}, target\)/)
    const route = readFileSync("app/api/campaigns/book/[slug]/route.ts", "utf8")
    assert.match(route, /body\.embed === true \? await loadBookingEmbedReturn\(page\.source_id\)/)
})
