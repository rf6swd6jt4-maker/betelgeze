// Real CenteredDialog portals and actual iframe document departures, no external I/O.
import { spawn } from "node:child_process"
import { mkdir, writeFile } from "node:fs/promises"
import assert from "node:assert/strict"
import { chromium, webkit } from "playwright"
const selected = process.argv.slice(2)
if (selected.some(name => !["chromium", "webkit"].includes(name))) throw Error("Use chromium and/or webkit")
const output = process.env.MODAL_OWNER_OUTPUT ?? "browser-results/modal-owner"
const server = spawn(process.execPath, ["scripts/serve-context-overlays-fixture.mjs"], { stdio: ["ignore", "pipe", "pipe"] })
const results = []
await mkdir(output, { recursive: true })
try {
    const origin = await new Promise((resolve, reject) => {
        let log = ""
        const timer = setTimeout(() => reject(Error(`Fixture startup: ${log}`)), 90_000)
        const receive = chunk => { log = (log + chunk).slice(-12000); const match = log.match(/http:\/\/127\.0\.0\.1:\d+\//); if (match) { clearTimeout(timer); resolve(match[0]) } }
        server.stdout.on("data", receive); server.stderr.on("data", receive)
        server.once("exit", code => { clearTimeout(timer); reject(Error(`Fixture exit ${code}: ${log}`)) })
    })
    for (const engine of selected.length ? selected : ["chromium", "webkit"]) {
        const browser = await ({ chromium, webkit })[engine].launch()
        try {
            const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3, reducedMotion: "no-preference" })
            const errors = [], external = []
            await context.route("**/*", route => { if (new URL(route.request().url()).origin === new URL(origin).origin) return route.continue(); external.push(route.request().url()); return route.abort() })
            const page = await context.newPage()
            page.on("pageerror", error => errors.push(error.message))
            for (const action of ["remove", "navigate", "reload", "inactive-remove", "inactive-navigate", "inactive-reload", "inactive", "persisted-active", "persisted-inactive"]) {
                try {
                    await page.goto(origin)
                    await page.locator("#background").waitFor()
                    await page.evaluate(() => {
                        document.body.dataset.workspaceActiveTabId = "fixture-frame"
                        const frame = document.createElement("iframe")
                        frame.id = "owner-frame"; frame.name = "betelgeze-tab:fixture-frame"; frame.src = "/?__betelgeze_tab=fixture-frame"
                        frame.style.cssText = "position:fixed;top:240px;left:20px;width:300px;height:200px"
                        document.body.append(frame)
                    })
                    await page.frameLocator("#owner-frame").locator("#modal-trigger").tap()
                    const dialog = page.getByRole("dialog", { name: "Saved form", exact: true })
                    await dialog.waitFor()
                    await dialog.getByRole("textbox", { name: "Draft" }).fill("Preserved portal draft")
                    await dialog.evaluate(node => { window.originalOwnerDialog = node })
                    if (["remove", "navigate", "reload"].some(kind => action.endsWith(kind))) {
                        if (action.startsWith("inactive-")) {
                            await page.evaluate(() => {
                                const frame = document.querySelector("#owner-frame")
                                document.body.dataset.workspaceActiveTabId = "other"; frame.hidden = true
                                frame.contentWindow.dispatchEvent(new Event("betelgeze:workspace-tab-visibility"))
                            })
                            await page.waitForFunction(() => !document.querySelector("dialog[open]"))
                        }
                        await page.evaluate(kind => {
                            const frame = document.querySelector("#owner-frame")
                            if (kind === "remove") frame.remove()
                            else if (kind === "navigate") frame.src = "/?__betelgeze_tab=fixture-frame&destination=next"
                            else frame.contentWindow.location.reload()
                        }, action.replace("inactive-", ""))
                        await page.waitForFunction(() => !document.querySelector("dialog"), undefined, { timeout: 3_000 })
                        assert.equal(await page.evaluate(() => window.originalOwnerDialog.isConnected), false, "retired owner leaves no orphan portal DOM")
                    } else {
                        await page.evaluate(kind => {
                            const frame = document.querySelector("#owner-frame")
                            if (kind === "inactive") {
                                document.body.dataset.workspaceActiveTabId = "other"
                                frame.hidden = true
                                frame.contentWindow.dispatchEvent(new Event("betelgeze:workspace-tab-visibility"))
                            } else {
                                frame.contentWindow.dispatchEvent(new frame.contentWindow.PageTransitionEvent("pagehide", { persisted: true }))
                            }
                        }, action)
                        await page.waitForFunction(() => !document.querySelector("dialog[open]"), undefined, { timeout: 3_000 })
                        assert.equal(await page.locator("dialog").count(), 1, "retained document keeps its draft DOM")
                        if (action === "persisted-inactive") {
                            await page.evaluate(() => {
                                const frame = document.querySelector("#owner-frame")
                                document.body.dataset.workspaceActiveTabId = "other"; frame.hidden = true
                                frame.contentWindow.dispatchEvent(new Event("betelgeze:workspace-tab-visibility"))
                            })
                            // Let the actual hook commit its inactive presentation.
                            await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
                            await page.evaluate(() => {
                                const frame = document.querySelector("#owner-frame")
                                frame.contentWindow.dispatchEvent(new frame.contentWindow.PageTransitionEvent("pageshow", { persisted: true }))
                            })
                            assert.equal(await page.locator("dialog[open]").count(), 0, "cached hidden owner cannot regain the top layer")
                        }
                        await page.locator("#shell-header-action").tap()
                        await page.evaluate(kind => {
                            const frame = document.querySelector("#owner-frame")
                            document.body.dataset.workspaceActiveTabId = "fixture-frame"; frame.hidden = false
                            if (kind === "persisted-active") frame.contentWindow.dispatchEvent(new frame.contentWindow.PageTransitionEvent("pageshow", { persisted: true }))
                            else frame.contentWindow.dispatchEvent(new Event("betelgeze:workspace-tab-visibility"))
                        }, action)
                        await dialog.waitFor()
                        assert.equal(await dialog.evaluate(node => node === window.originalOwnerDialog), true)
                        assert.equal(await dialog.getByRole("textbox", { name: "Draft" }).inputValue(), "Preserved portal draft")
                        await dialog.getByRole("button", { name: "Close popup", exact: true }).tap()
                        await dialog.waitFor({ state: "detached" })
                    }
                    await page.locator("#shell-header-action").tap()
                    assert.equal(await page.locator("dialog:modal").count(), 0)
                    await page.screenshot({ path: `${output}/${engine}-${action}.png` })
                    results.push({ engine, action, passed: true })
                    console.log(`${engine}: ${action} releases exact owner and preserves retained state`)
                } catch (error) {
                    results.push({ engine, action, passed: false, error: String(error) })
                    console.error(`${engine}: ${action}: ${error}`)
                    await page.screenshot({ path: `${output}/${engine}-${action}-failed.png` })
                }
            }
            assert.deepEqual(errors, []); assert.deepEqual(external, [])
            await context.close()
        } finally { await browser.close() }
    }
} finally {
    server.kill("SIGTERM")
    await mkdir("browser-results", { recursive: true })
    await writeFile("browser-results/modal-owner-lifecycle.json", JSON.stringify({ results, limits: "Actual iframe removal, navigation and reload with real shared native dialogs; bfcache retention is an explicit persisted-event simulation. Synthetic local data, no production session or physical device." }, null, 2))
}
assert(results.every(result => result.passed), "Modal owner lifecycle regression failed")
