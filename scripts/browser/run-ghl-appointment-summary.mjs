// Render the actual server-only summary components with synthetic local data.
// This is browser layout evidence, never provider, production, or device evidence.
import assert from "node:assert/strict"
import { createServer } from "node:http"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { createRequire, Module } from "node:module"
import { dirname, resolve } from "node:path"
import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import postcss from "postcss"
import tailwind from "@tailwindcss/postcss"
import ts from "typescript"
import { chromium, webkit } from "playwright"

const engines = process.argv.slice(2)
if (engines.some(engine => !["chromium", "webkit"].includes(engine))) throw Error("Usage: run-ghl-appointment-summary.mjs [chromium|webkit]")
if (!engines.length) engines.push("chromium", "webkit")
const root = process.cwd(), loaded = new Map()
const localRequire = createRequire(import.meta.url)
function load(file) {
    const filename = [file, `${file}.ts`, `${file}.tsx`].find(existsSync)
    if (!filename) throw Error(`Missing fixture module: ${file}`)
    if (loaded.has(filename)) return loaded.get(filename)
    const compiled = new Module(filename)
    const source = ts.transpileModule(readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
    compiled.require = name => name.startsWith("@/") ? load(resolve(root, name.slice(2))) : name.startsWith(".") ? load(resolve(dirname(filename), name)) : localRequire(name)
    compiled._compile(source, filename)
    loaded.set(filename, compiled.exports)
    return compiled.exports
}
const { ClientPortalAppointmentSummary, ClientPortalAppointmentUnavailable } = load(resolve(root, "components/client-portal/ClientPortalAppointmentSummary.tsx"))
const { appointmentSummary } = load(resolve(root, "lib/client-portal/appointment-summary.ts"))
const { appStartupBootstrap, appStartupStyles } = load(resolve(root, "lib/app-startup.ts"))
const fixture = { snapshot: { id: "example-12345678", title: "Window consultation with a long appointment title", calendarName: "Consultations", contactName: "Alex Morgan", startTime: "2026-10-14T18:30:00Z", endTime: "2026-10-14T19:00:00Z", timezone: "America/New_York", status: "confirmed", contactDetails: "+1 202 555 0123; alex@example.com", meetingDetails: "Phone consultation\nCall +1 202 555 0123", bookingDetails: "Six windows.\n" + "Long booking note ".repeat(25), deleted: false,
    details: { schemaVersion: 1, contact: { phone: "+1 202 555 0123", email: "alex@example.com", company: "Example company", address: "1 Street, Dallas, TX" }, meeting: { location: "Meeting instructions ".repeat(150), joinUrl: "https://meeting.example/consultation" }, booking: { state: "available", text: "Six windows" }, source: { createdAt: "2026-10-01T09:00:00Z" } } }, observedAt: "2026-10-11T09:00:00Z", version: 3 }
const longQuestion = "Which rooms and installation requirements should the team prepare for? " + "AdditionalQuestionContext".repeat(5)
const longAnswer = "Please include the living room and upstairs windows.\n" + "SavedAnswerWithoutWordBreaks".repeat(30)
const htmlQuestion = '<img src=x onerror="window.__leadHtmlExecuted=true"> Preferred appointment notes?'
const htmlAnswer = '<script>window.__leadHtmlExecuted=true</script>\n<iframe src="https://hostile.invalid"></iframe> Keep this as plain text.'
const missingFields = [{ fieldId: "missing", label: "Missing answer", value: "" }, { fieldId: "null", label: "Null answer", value: null }, { fieldId: "absent", label: "Absent answer" }]
const leadFixtures = {
    "lead-rich": { source: "facebook_lead_ads", type: "new-lead", capturedAt: "2026-10-10T12:00:00Z", fields: [{ fieldId: "rooms", label: longQuestion, value: longAnswer }, { fieldId: "notes", label: htmlQuestion, value: htmlAnswer }, ...missingFields] },
    "lead-source": { source: "facebookLeadAds", type: null, capturedAt: null, fields: [] },
    "lead-missing": { source: null, type: null, capturedAt: "2026-10-10T12:00:00Z", fields: missingFields },
    "lead-empty": { source: null, type: null, capturedAt: "2026-10-10T12:00:00Z", fields: [] },
}
const scenarios = ["confirmed", "updated", "cancelled", "removed", "unavailable", "error", "lead-rich", "lead-source", "lead-missing", "lead-empty", "legacy"]
const css = (await postcss([tailwind({ base: root, optimize: false })]).process(readFileSync("app/globals.css", "utf8"), { from: resolve("app/globals.css") })).css
const server = createServer((request, response) => {
    const url = new URL(request.url, "http://127.0.0.1")
    if (url.pathname === "/style.css") { response.writeHead(200, { "Content-Type": "text/css" }); response.end(css); return }
    const scenario = url.searchParams.get("scenario")
    const summary = appointmentSummary({ ...fixture, snapshot: { ...fixture.snapshot, status: scenario === "cancelled" ? "cancelled" : "confirmed", deleted: scenario === "removed", details: scenario === "legacy" ? undefined : { ...fixture.snapshot.details, lead: leadFixtures[scenario] } } })
    const content = ["unavailable", "error"].includes(scenario)
        ? React.createElement(ClientPortalAppointmentUnavailable, { retryable: scenario === "error" })
        : React.createElement(ClientPortalAppointmentSummary, { summary, displayName: "Example Agency", notifiedVersion: scenario === "updated" ? 2 : null })
    response.writeHead(200, { "Content-Type": "text/html", "Cache-Control": "no-store" })
    response.end(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${appStartupStyles}</style><script>${appStartupBootstrap}</script><link rel="stylesheet" href="/style.css"></head><body>${renderToStaticMarkup(content)}</body></html>`)
})
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve))
const origin = `http://127.0.0.1:${server.address().port}`
const results = [], output = "browser-results/ghl-appointment-summary"
mkdirSync(output, { recursive: true })
try {
    for (const engine of engines) {
        const browser = await ({ chromium, webkit })[engine].launch()
        try {
            for (const width of [320, 390, 1280]) {
                const context = await browser.newContext({ viewport: { width, height: 844 }, isMobile: width < 500, hasTouch: width < 500 })
                const page = await context.newPage(), errors = [], requests = []
                page.on("pageerror", error => errors.push(error.message))
                page.on("request", request => requests.push(request.url()))
                for (const scenario of scenarios) {
                    await page.goto(`${origin}/appointment/${"a".repeat(64)}?scenario=${scenario}`)
                    await page.locator("main").waitFor()
                    assert.equal(await page.evaluate(() => document.documentElement.dataset.appStartup), "client")
                    assert.equal(await page.locator("[data-app-startup-screen]").count(), 0)
                    const geometry = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }))
                    assert.ok(geometry.scroll <= geometry.width, JSON.stringify({ engine, width, scenario, geometry }))
                    if (!["unavailable", "error"].includes(scenario)) {
                        assert.ok(await page.getByText("Alex Morgan", { exact: true }).isVisible())
                        assert.ok(await page.getByText("Oct 14, 2026, 2:30 PM EDT", { exact: true }).isVisible())
                        assert.ok(await page.getByText("Example Agency", { exact: false }).isVisible())
                        assert.equal(await page.locator("h1").evaluate(node => getComputedStyle(node).color), "rgb(15, 23, 42)")
                        assert.ok(await page.getByText(scenario === "removed" ? "Removed from calendar" : scenario === "cancelled" ? "Cancelled" : "Confirmed", { exact: true }).isVisible())
                        if (scenario !== "legacy") {
                            assert.equal(await page.getByRole("link", { name: "+1 202 555 0123", exact: true }).getAttribute("href"), "tel:+12025550123")
                            assert.equal(await page.getByRole("link", { name: "alex@example.com", exact: true }).getAttribute("href"), "mailto:alex@example.com")
                            assert.equal(await page.getByRole("link", { name: "Open meeting link", exact: true }).getAttribute("rel"), "noopener noreferrer")
                        } else assert.ok(await page.getByText(fixture.snapshot.contactDetails, { exact: true }).isVisible())
                        const lead = page.getByRole("region", { name: "Lead information", exact: true })
                        if (["lead-rich", "lead-source"].includes(scenario)) {
                            assert.ok(await lead.isVisible())
                            assert.ok(await lead.getByText("Saved contact information from GHL. These are not verified original booking answers.", { exact: true }).isVisible())
                            assert.ok(await lead.getByText(scenario === "lead-rich" ? "Facebook lead ads" : "Facebook Lead Ads", { exact: true }).isVisible())
                            assert.equal(await lead.locator("script, img, iframe, a").count(), 0, "Saved lead information must remain plain text")
                            if (scenario === "lead-rich") {
                                for (const text of [longQuestion, longAnswer, htmlQuestion, htmlAnswer, "New lead", "Last saved", "Oct 10, 2026, 8:00 AM EDT"]) assert.ok(await lead.getByText(text, { exact: true }).isVisible(), text)
                                for (const label of ["Missing answer", "Null answer", "Absent answer"]) assert.equal(await lead.getByText(label, { exact: true }).count(), 0)
                                assert.equal(await page.evaluate(() => window.__leadHtmlExecuted), undefined)
                            } else assert.equal(await lead.getByText("Last saved", { exact: true }).count(), 0)
                        } else assert.equal(await lead.count(), 0, `${scenario} must not show an empty lead section`)
                        if (scenario === "updated") assert.match(await page.locator("main").innerText(), /changed since the notification/)
                        if (["cancelled", "removed"].includes(scenario)) assert.match(await page.locator("main").innerText(), /retained here/)
                    } else {
                        assert.equal(await page.getByText("Alex Morgan", { exact: true }).count(), 0)
                        assert.match(await page.locator("h1").innerText(), scenario === "error" ? /could not load/ : /not available/)
                    }
                    if (width === 390) await page.screenshot({ path: `${output}/${engine}-${scenario}.png`, fullPage: true })
                    results.push({ engine, width, scenario, passed: true })
                }
                assert.deepEqual(errors, [])
                assert.equal(requests.filter(url => new URL(url).origin !== origin || url.includes("/api/")).length, 0)
                await context.close()
            }
        } finally { await browser.close() }
        console.log(`${engine}: ${scenarios.length * 3} summary scenarios passed`)
    }
} finally {
    await new Promise(resolve => server.close(resolve))
    const reportName = engines.length === 1 ? `report-${engines[0]}.json` : "report.json"
    writeFileSync(`${output}/${reportName}`, JSON.stringify({ results, limits: "Actual server components and CSS, synthetic data. No authenticated provider calls, production timings, or physical-device claim." }, null, 2))
}
