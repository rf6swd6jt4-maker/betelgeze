// Actual OKR modal, synthetic forms, no server-action writes.
import { spawn } from "node:child_process"
import { mkdir, writeFile } from "node:fs/promises"
import assert from "node:assert/strict"
import { chromium, webkit } from "playwright"
const selected = process.argv.slice(2)
if (selected.some(engine => !["chromium", "webkit"].includes(engine))) throw Error("Use chromium and/or webkit")
const server = spawn(process.execPath, ["scripts/serve-settings-popup-ownership-fixture.mjs"], { stdio: ["ignore", "pipe", "pipe"] })
const results = []
await mkdir("browser-results", { recursive: true })
try {
    const origin = await new Promise((resolve, reject) => {
        let output = ""
        const timer = setTimeout(() => reject(Error(`Fixture startup: ${output}`)), 90000)
        const receive = chunk => { output = (output + chunk).slice(-12000); const match = output.match(/http:\/\/127\.0\.0\.1:\d+\//); if (match) { clearTimeout(timer); resolve(match[0]) } }
        server.stdout.on("data", receive); server.stderr.on("data", receive)
        server.once("error", error => { clearTimeout(timer); reject(error) })
        server.once("exit", code => { clearTimeout(timer); reject(Error(`Fixture exit ${code}: ${output}`)) })
    })
    for (const engine of selected.length ? selected : ["chromium", "webkit"]) {
        const browser = await ({ chromium, webkit })[engine].launch()
        try {
            for (const action of ["native-close", "native-inactive", "frame-close", "remove", "navigate", "reload", "inactive-remove"]) {
                const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
                const errors = [], external = []
                await context.route("**/*", route => {
                    const url = new URL(route.request().url())
                    if (url.origin === new URL(origin).origin && !url.pathname.startsWith("/api/")) return route.continue()
                    external.push(url.href); return route.abort()
                })
                try {
                    const page = await context.newPage()
                    page.setDefaultTimeout(5000)
                    page.on("pageerror", error => errors.push(error.message))
                    const framed = !action.startsWith("native")
                    await page.goto(`${origin}${framed ? "host" : ""}?type=okr`)
                    const frame = framed ? await (await page.locator("iframe").elementHandle()).contentFrame() : page.mainFrame()
                    await frame.waitForFunction(() => Boolean(window.fixture))
                    await frame.getByRole("button", { name: /Add Objective$/ }).tap()
                    const dialog = page.getByRole("dialog", { name: "Add Objective", exact: true })
                    await dialog.waitFor()
                    await dialog.getByRole("textbox", { name: "Objective", exact: true }).fill("Keep this objective draft")
                    if (action === "native-inactive") {
                        await frame.evaluate(() => window.fixture.setActive(false))
                        await page.waitForFunction(() => !document.querySelector("dialog[open]"))
                        await page.locator("#outside").first().tap()
                        await frame.evaluate(() => window.fixture.setActive(true))
                        await dialog.waitFor()
                        assert.equal(await dialog.getByRole("textbox", { name: "Objective", exact: true }).inputValue(), "Keep this objective draft")
                        await page.keyboard.press("Escape")
                        await dialog.waitFor({ state: "detached" })
                    } else if (action.endsWith("close")) {
                        await dialog.getByRole("button", { name: "Close", exact: true }).tap()
                        await dialog.waitFor({ state: "detached" })
                    } else {
                        if (action === "inactive-remove") {
                            await frame.evaluate(() => window.fixture.setActive(false))
                            await page.waitForFunction(() => !document.querySelector("dialog[open]"))
                        }
                        await page.evaluate(kind => {
                            const frame = document.querySelector("iframe")
                            if (kind === "navigate") frame.src = "/blank"
                            else if (kind === "reload") frame.contentWindow.location.reload()
                            else frame.remove()
                        }, action)
                        await page.waitForFunction(() => !document.querySelector('dialog, [role="dialog"]'))
                    }
                    assert.equal(await page.locator('dialog, [role="dialog"]').count(), 0)
                    await page.locator("#outside").first().tap()
                    assert.deepEqual(errors, []); assert.deepEqual(external, [])
                    results.push({ engine, action, passed: true })
                    console.log(`${engine}: OKR ${action} passed`)
                } catch (error) { results.push({ engine, action, passed: false, error: String(error) }); throw error }
                finally { await context.close() }
            }
        } finally { await browser.close() }
    }
} finally {
    server.kill("SIGTERM")
    await writeFile("browser-results/okr-popup-lifetime.json", JSON.stringify({ results, limits: "Actual OKR component with synthetic local data. No writes, authenticated session or physical-device evidence." }, null, 2))
}
