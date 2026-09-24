// Real Team/Client components and local synthetic data. No account or provider I/O.
import { spawn } from "node:child_process"
import { mkdir, writeFile } from "node:fs/promises"
import assert from "node:assert/strict"
import { chromium, webkit } from "playwright"

const engines = process.argv.slice(2)
if (engines.some(engine => !["chromium", "webkit"].includes(engine))) throw Error("Use chromium and/or webkit")
const server = spawn(process.execPath, ["scripts/serve-fullscreen-comms-preview.mjs", "--host", "127.0.0.1", "--port", "0"], { stdio: ["ignore", "pipe", "pipe"] })
const origin = await new Promise((resolve, reject) => {
    let output = ""
    const timeout = setTimeout(() => reject(Error(`Preview did not start: ${output}`)), 90_000)
    const consume = chunk => {
        output = (output + chunk).slice(-12_000)
        const match = output.match(/http:\/\/localhost:(\d+)\//)
        if (match) { clearTimeout(timeout); resolve(`http://127.0.0.1:${match[1]}`) }
    }
    server.stdout.on("data", consume)
    server.stderr.on("data", consume)
    server.once("exit", code => { clearTimeout(timeout); reject(Error(`Preview exited ${code}: ${output}`)) })
})
const results = []
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
await mkdir("browser-results", { recursive: true })
try {
    for (const engine of engines.length ? engines : ["chromium", "webkit"]) {
        const browser = await ({ chromium, webkit })[engine].launch()
        const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
        const errors = [], external = []
        await context.route("**/*", route => {
            const url = new URL(route.request().url())
            if (url.origin === origin || ["blob:", "data:"].includes(url.protocol)) return route.continue()
            external.push(url.origin); return route.abort()
        })
        const page = await context.newPage()
        page.on("pageerror", error => errors.push(error.message))
        await page.goto(origin)
        await page.getByRole("tab", { name: "Clients", exact: true }).click()
        await page.getByText("Northstar Studio", { exact: true }).click()
        await page.waitForFunction(() => document.querySelector("[data-mobile-conversation-surface]:not([hidden])")?.dataset.phase === "open")
        const surface = page.locator("[data-mobile-conversation-surface]:not([hidden])")
        const opener = surface.getByRole("button", { name: "Client portal actions", exact: true })
        const dialog = page.getByRole("dialog", { name: "Client portal", exact: true })
        const check = async (name, run) => {
            await run(); results.push({ engine, name, passed: true }); console.log(`${engine}: ${name}`)
        }
        await page.evaluate(() => {
            const original = window.fetch
            window.portalTest = { reads: 0, writes: 0, holdRead: false, holdWrite: false, failWrite: false, releaseRead: null, releaseWrite: null }
            const overview = title => ({ hasFulfilment: true, leadMode: "empty", actions: [{ id: "action-one", title: window.portalTest.longTitle ? "L".repeat(240) : title, status: "open", completedAt: null, updatedAt: new Date().toISOString() }], progress: [{ id: "progress-one", serviceName: "Synthetic service", status: "preparing", updatedAt: new Date().toISOString() }] })
            window.fetch = async (input, init) => {
                if (!String(input).endsWith("/portal")) return original(input, init)
                const t = window.portalTest, method = init?.method ?? "GET"
                if (method === "GET") {
                    const read = ++t.reads
                    if (t.holdRead) { t.holdRead = false; await new Promise(resolve => { t.releaseRead = resolve }) }
                    return Response.json(overview(`Read ${read}`))
                }
                ++t.writes
                if (t.holdWrite) { t.holdWrite = false; await new Promise(resolve => { t.releaseWrite = resolve }) }
                if (t.failWrite) return Response.json({ error: "Synthetic portal failure" }, { status: 400 })
                return Response.json(overview(`Saved ${t.writes}`))
            }
        })
        await check("portal: closed request cannot overwrite reopened dialog", async () => {
            await page.evaluate(() => { window.portalTest.holdRead = true })
            await opener.click()
            await dialog.getByRole("button", { name: "Close popup" }).click()
            await opener.click()
            await dialog.getByText("Read 2", { exact: true }).waitFor()
            await page.evaluate(() => window.portalTest.releaseRead())
            await pause(100)
            assert.equal(await dialog.getByText("Read 1", { exact: true }).count(), 0)
        })
        await check("portal: pending submission disables competing controls and accepts only once", async () => {
            await page.evaluate(() => { window.portalTest.holdWrite = true })
            await dialog.getByRole("textbox", { name: "New required action" }).fill("Synthetic action")
            await dialog.getByRole("button", { name: "Add", exact: true }).click()
            await page.waitForFunction(() => window.portalTest.writes === 1)
            assert.equal(await dialog.getByRole("textbox", { name: "New required action" }).isDisabled(), true)
            assert.equal(await dialog.getByRole("button", { name: "Read 2", exact: true }).isDisabled(), true)
            assert.equal(await dialog.getByRole("button", { name: "Synthetic service Preparing", exact: true }).isDisabled(), true)
            await dialog.locator("form").evaluate(form => form.requestSubmit())
            await pause(60)
            assert.equal(await page.evaluate(() => window.portalTest.writes), 1)
            await page.evaluate(() => window.portalTest.releaseWrite())
            await dialog.getByText("Saved 1", { exact: true }).waitFor()
        })
        await check("portal: old refresh cannot replace a later acknowledged update", async () => {
            await dialog.getByRole("button", { name: "Close popup" }).click()
            await page.evaluate(() => { window.portalTest.holdRead = true })
            await opener.click()
            await dialog.getByRole("textbox", { name: "New required action" }).fill("Another synthetic action")
            await dialog.getByRole("button", { name: "Add", exact: true }).click()
            await dialog.getByText("Saved 2", { exact: true }).waitFor()
            await page.evaluate(() => window.portalTest.releaseRead())
            await pause(100)
            assert.equal(await dialog.getByText("Read 3", { exact: true }).count(), 0)
        })
        await check("portal: failed save preserves the form for retry", async () => {
            await page.evaluate(() => { window.portalTest.failWrite = true })
            const input = dialog.getByRole("textbox", { name: "New required action" })
            await input.fill("Retain this action")
            await dialog.getByRole("button", { name: "Add", exact: true }).click()
            await dialog.getByText("Synthetic portal failure").waitFor()
            assert.equal(await input.inputValue(), "Retain this action")
            assert.equal(await input.isEnabled(), true)
        })
        await check("portal: long action titles wrap inside the dialog", async () => {
            await dialog.getByRole("button", { name: "Close popup" }).click()
            await page.evaluate(() => { window.portalTest.longTitle = true })
            await opener.click()
            const action = dialog.getByRole("button", { name: "L".repeat(240), exact: true })
            await action.waitFor()
            assert.equal(await action.evaluate(button => button.scrollWidth <= button.clientWidth + 1), true)
        })
        await check("portal: leaving the active Comms mode dismisses its modal", async () => {
            await page.locator('[role="tab"]').filter({ hasText: /^Work$/ }).evaluate(button => button.click())
            await dialog.waitFor({ state: "detached" })
            await page.getByRole("tab", { name: "Comms", exact: true }).click()
            assert.equal(await dialog.count(), 0)
        })
        assert.deepEqual(errors, [], "Browser exceptions")
        assert.deepEqual(external, [], "External requests")
        await context.close(); await browser.close()
    }
} finally {
    server.kill("SIGTERM")
    await writeFile("browser-results/comms-portal-polish.json", JSON.stringify({ observedAt: new Date().toISOString(), results, limits: "Actual ClientPortalActions in synthetic workspace, controlled local responses, no production portal writes or physical device checks." }, null, 2))
}
