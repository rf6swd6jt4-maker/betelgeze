import { spawn } from "node:child_process"
import { mkdir, writeFile } from "node:fs/promises"
import assert from "node:assert/strict"
import { chromium, webkit } from "playwright"
const engines = process.argv.slice(2)
if (engines.some(engine => !["chromium", "webkit"].includes(engine))) throw Error("Use chromium and/or webkit")
const server = spawn(process.execPath, ["scripts/serve-ui-reconciliation-fixture.mjs"], { stdio: ["ignore", "pipe", "pipe"] })
const results = []
await mkdir("browser-results", { recursive: true })
try {
    const origin = await new Promise((resolve, reject) => {
        let output = ""
        const timer = setTimeout(() => reject(Error(`Fixture startup timeout: ${output}`)), 90_000)
        const consume = chunk => { output = (output + chunk).slice(-12000); const match = output.match(/http:\/\/127\.0\.0\.1:\d+\//); if (match) { clearTimeout(timer); resolve(match[0]) } }
        server.stdout.on("data", consume); server.stderr.on("data", consume)
        server.once("error", error => { clearTimeout(timer); reject(error) })
        server.once("exit", code => { clearTimeout(timer); reject(Error(`Fixture exit ${code}: ${output}`)) })
    })
    for (const engine of engines.length ? engines : ["chromium", "webkit"]) {
        const browser = await ({ chromium, webkit })[engine].launch()
        try {
            for (const framed of [false, true]) {
                const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
                try {
                    const errors = [], external = []
                    await context.route("**/*", route => { if (new URL(route.request().url()).origin === new URL(origin).origin) return route.continue(); external.push(route.request().url()); return route.abort() })
                    const page = await context.newPage(); page.on("pageerror", error => errors.push(error.message))
                    await page.goto(origin + (framed ? "host" : ""))
                    const frame = framed ? await (await page.locator("iframe").elementHandle()).contentFrame() : page.mainFrame()
                    await frame.waitForFunction(() => !!window.fixture)
                    const check = async (name, run) => { try { await run(); results.push({ engine, framed, name, passed: true }) } catch (error) { results.push({ engine, framed, name, passed: false, error: String(error) }); throw error } }
                    const open = async () => { await frame.locator("#opener").focus(); await frame.locator("#opener").press("Enter"); await page.locator("dialog[open]").waitFor() }
                    for (const method of ["button", "escape", "backdrop"]) {
                        await check(`native dialog closes before deferred parent dismissal: ${method}`, async () => {
                            await open()
                            if (method === "button") await page.getByRole("button", { name: "Close popup" }).click()
                            else if (method === "escape") await page.keyboard.press("Escape")
                            else await page.locator("dialog").click({ position: { x: 2, y: 2 } })
                            assert.equal(await frame.evaluate(() => window.fixture.closedAtCallback.at(-1)), false)
                            assert.equal(await page.locator("dialog:modal").count(), 0)
                            assert.equal(await page.locator("dialog").isVisible(), false)
                            // Parent intentionally retains the component until explicitly released.
                            await frame.evaluate(() => window.releaseDismiss())
                            await page.locator("dialog").waitFor({ state: "detached" })
                            await frame.waitForFunction(() => document.activeElement?.id === "opener")
                        })
                    }
                    await check("busy dialog blocks backdrop and Escape dismissal", async () => {
                        await open(); await frame.evaluate(() => window.fixture.busy(true)); await page.waitForFunction(() => document.querySelector('button[aria-label="Close popup"]')?.disabled)
                        await page.keyboard.press("Escape"); await page.locator("dialog").click({ position: { x: 2, y: 2 } })
                        assert.equal(await page.locator("dialog:modal").count(), 1)
                        await frame.evaluate(() => window.fixture.busy(false)); await page.getByRole("button", { name: "Close popup" }).click(); await frame.evaluate(() => window.releaseDismiss()); await page.locator("dialog").waitFor({ state: "detached" })
                    })
                    await check("inactive resident owner releases native top layer", async () => {
                        await open(); await frame.evaluate(() => window.fixture.active(false)); await page.waitForFunction(() => !document.querySelector("dialog:modal")); await frame.evaluate(() => { window.fixture.open(false); window.fixture.active(true) })
                    })
                    await check("refresh spinner stays compact and does not intercept content", async () => {
                        const spinner = frame.getByRole("status", { name: "Refreshing tab" }); const box = await spinner.boundingBox()
                        assert(box && box.width <= 40 && box.height <= 40, JSON.stringify(box))
                        assert.equal(await spinner.evaluate(node => getComputedStyle(node).pointerEvents), "none")
                        await frame.locator("#underlying").click()
                        await frame.evaluate(() => window.fixture.refreshing(false)); await spinner.waitFor({ state: "detached" })
                    })
                    await check("banner placeholder reserves visible space", async () => {
                        const banner = frame.getByLabel("Loading workspace banner"); const box = await banner.boundingBox(); assert(box && box.height >= 115); assert.equal(await banner.getAttribute("aria-busy"), "true")
                    })
                    assert.deepEqual(errors, []); assert.deepEqual(external, [])
                    console.log(`${engine} ${framed ? "resident-frame" : "standalone"}: 7/7`)
                } finally { await context.close() }
            }
        } finally { await browser.close() }
    }
} finally {
    server.kill("SIGTERM")
    await writeFile(process.env.UI_RECONCILIATION_REPORT ?? "browser-results/ui-reconciliation.json", JSON.stringify({ results, limits: "Actual components and CSS with synthetic state; no production calls or physical-device claim." }, null, 2))
}
