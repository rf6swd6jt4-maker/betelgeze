// Actual Shell/Leads/Calendar/Summary owners, synthetic local HTTP only.
import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { mkdir } from "node:fs/promises"
import { chromium, webkit } from "playwright"

const engines = process.argv.slice(2)
assert.ok(engines.every(name => ["chromium", "webkit"].includes(name)))
const server = spawn(process.execPath, ["scripts/serve-client-connections-fixture.mjs"], { env: { ...process.env, BE_APPOINTMENT_PORTAL_FIXTURE: "1" }, stdio: ["ignore", "pipe", "pipe"] })
let output = ""
server.stderr.on("data", chunk => { output = (output + chunk).slice(-12000) })
try {
    const origin = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(Error(`Fixture startup timed out: ${output}`)), 90000)
        server.stdout.on("data", chunk => { output += chunk; const match = output.match(/http:\/\/127\.0\.0\.1:\d+\//); if (match) { clearTimeout(timeout); resolve(match[0]) } })
        server.once("exit", code => { clearTimeout(timeout); reject(Error(`Fixture exited ${code}: ${output}`)) })
    })
    await mkdir("browser-results/portal-appointment-navigation", { recursive: true })
    for (const [engineName, engine] of [["chromium", chromium], ["webkit", webkit]].filter(([name]) => !engines.length || engines.includes(name))) {
        const browser = await engine.launch()
        try {
            for (const width of [390, 1280]) {
                let sharedPresentation
                for (const scenario of ["notification-back", "notification-tabs", "notification-deselected", "notification-revoked", "notification-empty", "notification-appointments", "calendar"]) {
                    const context = await browser.newContext({ viewport: { width, height: 844 }, locale: "en-US", timezoneId: "UTC", isMobile: width < 500, hasTouch: width < 500 })
                    const page = await context.newPage(), calls = [], errors = [], external = []
                    page.on("pageerror", error => errors.push(error.message))
                    await page.clock.install({ time: new Date("2026-10-15T12:00:00Z") })
                    await page.route("**/*", route => {
                        if (new URL(route.request().url()).origin === new URL(origin).origin) return route.continue()
                        external.push(route.request().url()); return route.abort()
                    })
                    const calendars = [{ id: "calendar123456789", name: "Visits" }, { id: "secondcalendar123", name: "Estimates" }]
                    await page.route("**/api/client-portal/session/fixture/**", async route => {
                        const request = route.request(), url = new URL(request.url())
                        calls.push({ path: url.pathname, query: url.search, method: request.method() })
                        assert.equal(request.method(), "GET", "Navigation must not cause provider mutations or message writes")
                        if (scenario === "notification-revoked") return route.fulfill({ status: 404, json: { error: "Synthetic portal access revoked" } })
                        if (url.pathname.endsWith("/connections/ghl")) return route.fulfill({ json: { connected: true, locationName: "Fixture GHL", metrics: { open: 1, won: 2, lost: 0, contacts: 3, opportunities: 3 } } })
                        if (url.pathname.endsWith("/resources")) return route.fulfill({ json: { resources: [], hasMore: false } })
                        if (url.pathname.endsWith("/appointments")) return route.fulfill({ json: { appointments: [], hasMore: false } })
                        if (url.pathname.endsWith("/calendar")) {
                            const month = url.searchParams.get("month"), id = url.searchParams.get("calendarId") ?? calendars[0].id
                            if (scenario === "notification-deselected" && id === "secondcalendar123") return route.fulfill({ status: 404, json: { error: "Synthetic calendar no longer selected" } })
                            return route.fulfill({ json: { revision: "revision1", calendars: scenario === "notification-deselected" ? [calendars[0]] : calendars, complete: true, refreshedAt: "2026-10-15T12:00:00Z", error: null, busy: false, snapshot: { source: "booking-calendar", calendarId: id, owner: { id, name: calendars.find(value => value.id === id).name }, month, timezone: "America/Chicago", snapshotId: "snapshot-" + id + month, namesStatus: "complete", events: month === "2026-08" && id === "secondcalendar123" ? [{ id: "appointment-fixture", kind: "appointment", title: "Shared appointment fixture", start: "2026-09-01T00:30:00Z", end: "2026-09-01T01:30:00Z", status: "confirmed", allDay: false, version: 4, detailsRetained: true }] : [] } } })
                        }
                        if (url.pathname.includes("/appointments/")) return route.fulfill({ json: { summary: await page.evaluate(() => window.appointmentFixture) } })
                        throw Error(`Unexpected fixture request: ${url.pathname}`)
                    })
                    const count = suffix => calls.filter(call => call.path.endsWith(suffix)).length
                    const frames = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
                    const back = page.getByRole("button", { name: "Back to calendar", exact: true })
                    const selectedDay = page.getByRole("button", { name: /Monday, August 31, 2026,/ })
                    const navigation = page.getByRole("navigation", { name: "Portal pages" })
                    let savedCalendarScroll = 0
                    const currentLeadMode = scenario === "notification-empty" ? "empty" : scenario === "notification-appointments" ? "appointments" : "ghl"
                    await page.goto(origin + (scenario === "calendar" ? "client-portal/session/fixture" : "appointment/fixture") + `?leadMode=${currentLeadMode}`)
                    if (scenario === "calendar") {
                        await page.locator("#ghl-results").waitFor({ state: "attached" })
                        await page.waitForFunction(() => document.querySelector('#resources input[type="file"]'))
                        assert.equal(count("/connections/ghl"), 1, "Normal entry retains its existing provider status load")
                        assert.equal(count("/resources"), 1, "Normal entry retains its existing Files load")
                        assert.equal(await page.locator("#fulfilment").isVisible(), true)
                        await navigation.getByRole("button", { name: "Leads", exact: true }).click()
                        await page.getByRole("button", { name: "Portal calendar", exact: true }).click()
                        await page.getByRole("option", { name: "Estimates", exact: true }).click()
                        await page.getByRole("button", { name: "Previous month", exact: true }).click()
                        await page.getByRole("heading", { name: "September 2026", exact: true }).waitFor()
                        await page.getByRole("button", { name: "Previous month", exact: true }).click()
                        await page.getByRole("heading", { name: "August 2026", exact: true }).waitFor()
                        await selectedDay.click()
                        await page.getByRole("button", { name: "Shared appointment fixture", exact: true }).scrollIntoViewIfNeeded()
                        // Capture at activation: WebKit may finish the automation's scroll-into-view immediately before click.
                        await page.evaluate(() => document.addEventListener("click", event => { if (event.target.closest("button")?.textContent === "Shared appointment fixture") window.calendarScrollAtActivation = document.querySelector("[data-client-portal-scroll]").scrollTop }, { capture: true }))
                        await page.getByRole("button", { name: "Shared appointment fixture", exact: true }).click()
                        savedCalendarScroll = await page.evaluate(() => window.calendarScrollAtActivation)
                    }
                    await page.locator('[data-client-portal-appointment="ready"]').waitFor()
                    await frames()
                    assert.equal(await page.locator("main").count(), 1, "Embedded appointment must not introduce a second main or scroll owner")
                    assert.equal(await page.locator("[data-portal-greeting]").isVisible(), false)
                    assert.equal(await page.locator("#ghl-results").isVisible(), false, "CRM grid is hidden while reading appointment details")
                    assert.equal(await page.locator("#appointments").isVisible(), false)
                    assert.equal(await back.isVisible(), true)
                    assert.equal(await page.locator("[data-client-portal-scroll]").evaluate(node => node.scrollTop), 0, "The existing portal scroll owner opens details at the top")
                    assert.equal(await page.getByRole("button", { name: "Chat", exact: true }).isVisible(), true)
                    assert.equal(await navigation.getByRole("button").count(), 4)
                    assert.equal(await page.getByText("Kitchen and living room", { exact: true }).isVisible(), true)
                    const presentation = await page.locator('[data-client-portal-appointment="ready"]').innerText()
                    if (sharedPresentation) assert.equal(presentation, sharedPresentation, "Notification and calendar must show the same appointment presentation")
                    else sharedPresentation = presentation
                    if (width === 390) await page.screenshot({ path: `browser-results/portal-appointment-navigation/${engineName}-${scenario}-details.png`, fullPage: true })
                    if (scenario !== "calendar") {
                        assert.deepEqual(calls, [], "Seeded notification opens without detail, calendar, provider status, Files or chat reads")
                        assert.equal(await page.locator('#resources input[type="file"]').count(), 0)
                    } else assert.equal(calls.filter(call => call.path.includes("/appointments/")).length, 1)
                    await page.evaluate(() => { window.savedCalendarNode = document.getElementById("appointments") })
                    if (scenario === "notification-tabs") {
                        await navigation.getByRole("button", { name: "Files", exact: true }).click()
                        await page.locator('#resources input[type="file"]').first().waitFor({ state: "attached" })
                        await page.locator("#ghl-results").waitFor({ state: "attached" })
                        await page.evaluate(() => { window.savedUploadInput = document.querySelector('#resources input[type="file"]') })
                        await navigation.getByRole("button", { name: "Leads", exact: true }).click()
                        await back.waitFor()
                        assert.equal(count("/calendar"), 0, "Tab return retains the seeded detail without loading its hidden calendar")
                        assert.equal(await page.evaluate(() => window.savedUploadInput === document.querySelector('#resources input[type="file"]')), true, "Mounted uploader survives navigation")
                    }
                    const calendarReads = count("/calendar")
                    await back.click()
                    if (currentLeadMode !== "ghl") {
                        const currentHeading = currentLeadMode === "empty" ? "Nothing here yet" : "No upcoming appointments"
                        await page.locator("#leads").getByRole("heading", { name: currentHeading, exact: true }).waitFor()
                        await frames()
                        assert.equal(await page.locator("[data-portal-greeting]").isVisible(), true)
                        assert.equal(await page.locator('[data-client-portal-appointment="ready"]').count(), 0)
                        assert.equal(count("/calendar"), 0, "Current lead mode does not load a retired GHL calendar on Back")
                        assert.equal(count("/connections/ghl"), 0)
                        assert.equal(count("/resources"), 1)
                        assert.equal(count("/appointments"), currentLeadMode === "appointments" ? 1 : 0)
                        const currentView = await page.locator("#leads").innerText()
                        await page.goto(origin + `client-portal/session/fixture?leadMode=${currentLeadMode}`)
                        await navigation.getByRole("button", { name: "Leads", exact: true }).click()
                        await page.locator("#leads").getByRole("heading", { name: currentHeading, exact: true }).waitFor()
                        assert.equal(await page.locator("#leads").innerText(), currentView, "Back from an old notification matches the current normal portal view")
                        assert.deepEqual(errors, []); assert.deepEqual(external, [])
                        console.log(`${engineName} ${width} ${scenario}: retained initial detail and current normal lead view parity passed`)
                        await context.close(); continue
                    }
                    if (["notification-deselected", "notification-revoked"].includes(scenario)) {
                        if (scenario === "notification-deselected") {
                            await page.getByText("Nothing scheduled on this day.", { exact: true }).waitFor()
                            assert.equal(await selectedDay.getAttribute("aria-pressed"), "true")
                            assert.equal(await page.getByRole("heading", { name: "August 2026", exact: true }).isVisible(), true)
                            assert.equal(await page.getByRole("alert").count(), 0, "A valid portal discovers its current calendar immediately")
                        } else {
                            await page.locator("#appointments").getByRole("alert").filter({ hasText: "Synthetic portal access revoked" }).waitFor()
                            assert.equal(await page.getByRole("list", { name: "Schedule on selected day" }).count(), 0)
                        }
                        await frames()
                        assert.equal(count("/calendar"), 2, "Rejected initial seed makes one authorized default-calendar read, without a retry loop")
                        assert.equal(new URLSearchParams(calls.filter(call => call.path.endsWith("/calendar"))[1].query).has("calendarId"), false)
                        assert.equal(await page.getByText("SYNTHETIC SHARED CONTACT", { exact: true }).count(), 0, "The closed seed cannot remain visible after scope rejection")
                        assert.equal(calls.filter(call => call.path.includes("/appointments/")).length, 0)
                        assert.deepEqual(errors, []); assert.deepEqual(external, [])
                        console.log(`${engineName} ${width} ${scenario}: one authorized default fallback and revoked access fail-closed passed`)
                        await context.close(); continue
                    }
                    await selectedDay.waitFor()
                    await page.getByRole("button", { name: "Shared appointment fixture", exact: true }).waitFor()
                    await frames()
                    assert.equal(await selectedDay.getAttribute("aria-pressed"), "true", "Back preserves the appointment day in its calendar timezone")
                    assert.equal(await page.getByRole("heading", { name: "August 2026", exact: true }).isVisible(), true, "First Back must not reset seeded month to the current month")
                    assert.equal(count("/calendar"), calendarReads + (scenario === "calendar" ? 0 : 1), "First seeded Back loads once; a warm calendar Back stays local")
                    assert.equal(await page.evaluate(() => window.savedCalendarNode === document.getElementById("appointments")), true, "Details do not remount the calendar owner")
                    assert.equal(await page.locator("[data-portal-greeting]").isVisible(), true)
                    if (scenario === "calendar") { const restoredScroll = await page.locator("[data-client-portal-scroll]").evaluate(node => node.scrollTop); assert.ok(Math.abs(restoredScroll - savedCalendarScroll) <= 1, `Back restores the calendar scroll position: ${restoredScroll} vs ${savedCalendarScroll}`) }
                    await page.locator("#ghl-results").waitFor()
                    assert.equal(count("/connections/ghl"), 1)
                    assert.equal(count("/resources"), 1)
                    assert.equal(calls.filter(call => call.path.includes("/appointments/")).length, scenario === "calendar" ? 1 : 0)
                    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
                    assert.deepEqual(errors, []); assert.deepEqual(external, [])
                    if (width === 390) await page.screenshot({ path: `browser-results/portal-appointment-navigation/${engineName}-${scenario}-calendar.png`, fullPage: true })
                    console.log(`${engineName} ${width} ${scenario}: identical details, deferred reads, retained calendar/date and full navigation passed`)
                    await context.close()
                }
            }
        } finally { await browser.close() }
    }
} finally { server.kill("SIGTERM") }
