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
const fixture = { snapshot: { id: "example-12345678", title: "Window consultation with a long appointment title", calendarName: "Consultations", contactName: "Alex Morgan", startTime: "2026-10-14T18:30:00Z", endTime: "2026-10-14T19:00:00Z", timezone: "America/New_York", status: "confirmed", contactDetails: "+1 202 555 0123; alex@example.com", meetingDetails: "Phone consultation\nCall +1 202 555 0123", bookingDetails: "Six windows.\n" + "Long booking note ".repeat(25), deleted: false }, observedAt: "2026-10-11T09:00:00Z", version: 3 }
const css = (await postcss([tailwind({ base: root, optimize: false })]).process(readFileSync("app/globals.css", "utf8"), { from: resolve("app/globals.css") })).css
const server = createServer((request, response) => {
    const url = new URL(request.url, "http://127.0.0.1")
    if (url.pathname === "/style.css") { response.writeHead(200, { "Content-Type": "text/css" }); response.end(css); return }
    const scenario = url.searchParams.get("scenario")
    const summary = appointmentSummary({ ...fixture, snapshot: { ...fixture.snapshot, status: scenario === "cancelled" ? "cancelled" : "confirmed", deleted: scenario === "removed" } })
    const content = ["unavailable", "error"].includes(scenario)
        ? React.createElement(ClientPortalAppointmentUnavailable, { retryable: scenario === "error" })
        : React.createElement(ClientPortalAppointmentSummary, { summary, displayName: "Example Agency" })
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
                for (const scenario of ["confirmed", "cancelled", "removed", "unavailable", "error"]) {
                    await page.goto(`${origin}/appointment/${"a".repeat(64)}?scenario=${scenario}`)
                    await page.locator("main").waitFor()
                    assert.equal(await page.evaluate(() => document.documentElement.dataset.appStartup), "client")
                    assert.equal(await page.locator("[data-app-startup-screen]").count(), 0)
                    const geometry = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }))
                    assert.ok(geometry.scroll <= geometry.width, JSON.stringify({ engine, width, scenario, geometry }))
                    if (["confirmed", "cancelled", "removed"].includes(scenario)) {
                        assert.ok(await page.getByText("Alex Morgan", { exact: true }).isVisible())
                        assert.ok(await page.getByText("Oct 14, 2026, 2:30 PM EDT", { exact: true }).isVisible())
                        assert.ok(await page.getByText("Example Agency", { exact: false }).isVisible())
                        assert.equal(await page.locator("h1").evaluate(node => getComputedStyle(node).color), "rgb(15, 23, 42)")
                        assert.ok(await page.getByText(scenario === "removed" ? "Removed from calendar" : scenario === "cancelled" ? "Cancelled" : "Confirmed", { exact: true }).isVisible())
                        if (scenario !== "confirmed") assert.match(await page.locator("main").innerText(), /retained here/)
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
        console.log(`${engine}: 15 summary scenarios passed`)
    }
} finally {
    await new Promise(resolve => server.close(resolve))
    const reportName = engines.length === 1 ? `report-${engines[0]}.json` : "report.json"
    writeFileSync(`${output}/${reportName}`, JSON.stringify({ results, limits: "Actual server components and CSS, synthetic data. No authenticated provider calls, production timings, or physical-device claim." }, null, 2))
}
