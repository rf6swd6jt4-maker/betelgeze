// Actual menu portals and parent listener accounting across iframe departure.
import { spawn } from "node:child_process"
import { mkdir, writeFile } from "node:fs/promises"
import assert from "node:assert/strict"
import { chromium, webkit } from "playwright"
const selected = process.argv.slice(2)
if (selected.some(name => !["chromium", "webkit"].includes(name))) throw Error("Use chromium and/or webkit")
const server = spawn(process.execPath, ["scripts/serve-anchored-popup-lifetime-fixture.mjs"], { stdio: ["ignore", "pipe", "pipe"] })
const results = []
await mkdir("browser-results", { recursive: true })
try {
    const origin = await new Promise((resolve, reject) => {
        let log = ""
        const timer = setTimeout(() => reject(Error(`Fixture startup: ${log}`)), 90_000)
        const receive = chunk => { log = (log + chunk).slice(-12000); const match = log.match(/http:\/\/127\.0\.0\.1:\d+\//); if (match) { clearTimeout(timer); resolve(match[0]) } }
        server.stdout.on("data", receive); server.stderr.on("data", receive)
        server.once("error", error => { clearTimeout(timer); reject(error) })
        server.once("exit", code => { clearTimeout(timer); reject(Error(`Fixture exit ${code}: ${log}`)) })
    })
    for (const engine of selected.length ? selected : ["chromium", "webkit"]) {
        const browser = await ({ chromium, webkit })[engine].launch()
        try {
            const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
            const errors = [], external = []
            await context.route("**/*", route => { if (new URL(route.request().url()).origin === new URL(origin).origin) return route.continue(); external.push(route.request().url()); return route.abort() })
            await context.addInitScript(() => {
                if (window.parent !== window) return
                const records = []
                const types = new Set(["keydown", "mousedown", "pointerdown", "scroll", "resize"])
                const monitored = (target, type) => types.has(type) && [window, document, window.visualViewport].includes(target)
                const capture = options => typeof options === "boolean" ? options : Boolean(options?.capture)
                const add = EventTarget.prototype.addEventListener, remove = EventTarget.prototype.removeEventListener
                EventTarget.prototype.addEventListener = function (type, callback, options) {
                    // The fixture has no parent app: only cross-realm callbacks
                    // belong to the iframe. Ignore Playwright's own parent-realm
                    // hit-target interceptors without hiding any owner closures.
                    if (monitored(this, type) && callback && !(callback instanceof Function) && !records.some(record => record.target === this && record.type === type && record.callback === callback && record.capture === capture(options))) records.push({ target: this, type, callback, capture: capture(options) })
                    return add.call(this, type, callback, options)
                }
                EventTarget.prototype.removeEventListener = function (type, callback, options) {
                    const index = records.findIndex(record => record.target === this && record.type === type && record.callback === callback && record.capture === capture(options))
                    if (index !== -1) records.splice(index, 1)
                    return remove.call(this, type, callback, options)
                }
                window.parentPopupListeners = () => records.length
                window.parentPopupListenerDetails = () => records.map(record => ({ type: record.type, target: record.target === window ? "window" : record.target === document ? "document" : "visualViewport", capture: record.capture, name: record.callback?.name }))
            })
            const page = await context.newPage()
            page.on("pageerror", error => errors.push(error.message))
            const tap = async locator => {
                const rect = await locator.boundingBox()
                assert(rect, "tap target is visible")
                await page.touchscreen.tap(rect.x + rect.width / 2, rect.y + rect.height / 2)
            }
            for (const action of ["remove", "navigate", "reload", "inactive", "navigation-start", "persisted", "outside", "escape"]) {
                try {
                    await page.goto(`${origin}host`)
                    await page.frameLocator("#owner-frame").locator("#popup-trigger").waitFor()
                    const before = await page.evaluate(() => window.parentPopupListeners())
                    await tap(page.frameLocator("#owner-frame").locator("#popup-trigger"))
                    await page.locator("[data-anchored-popup]").waitFor()
                    const during = await page.evaluate(() => window.parentPopupListeners())
                    assert(during > before, "fixture must exercise actual parent document/viewport listeners")
                    if (action === "outside") await tap(page.locator("#outside"))
                    else if (action === "escape") await page.keyboard.press("Escape")
                    else await page.evaluate(kind => {
                        const frame = document.querySelector("#owner-frame")
                        if (kind === "remove") frame.remove()
                        else if (kind === "navigate") frame.src = "/?__betelgeze_tab=fixture-frame&destination=next"
                        else if (kind === "reload") frame.contentWindow.location.reload()
                        else if (kind === "inactive") {
                            frame.hidden = true
                            frame.contentDocument.body.dataset.workspaceTabActive = "false"
                            frame.contentWindow.dispatchEvent(new Event("betelgeze:workspace-tab-visibility"))
                        } else if (kind === "navigation-start") frame.contentWindow.dispatchEvent(new Event("betelgeze:workspace-navigation-start"))
                        else frame.contentWindow.dispatchEvent(new frame.contentWindow.PageTransitionEvent("pagehide", { persisted: true }))
                    }, action)
                    await page.waitForFunction(() => ![...document.querySelectorAll("[data-anchored-popup]")].some(node => node.checkVisibility()), undefined, { timeout: 3000 })
                    assert.equal(await page.evaluate(() => window.parentPopupListeners()), before, `owner departure must release all parent listener closures: ${JSON.stringify(await page.evaluate(() => window.parentPopupListenerDetails()))}`)
                    if (action === "persisted") {
                        await page.evaluate(() => { const view = document.querySelector("#owner-frame").contentWindow; view.dispatchEvent(new view.PageTransitionEvent("pageshow", { persisted: true })) })
                        assert.equal(await page.locator("[data-anchored-popup]:visible").count(), 0, "cached documents cannot revive a dismissed menu")
                    }
                    if (["remove", "navigate", "reload"].includes(action)) assert.equal(await page.locator("[data-anchored-popup]").count(), 0, "destroyed source leaves no parent portal DOM")
                    await tap(page.locator("#outside"))
                    results.push({ engine, action, passed: true, parentListeners: { before, during, after: before } })
                    console.log(`${engine}: ${action} releases popup and parent listeners`)
                } catch (error) {
                    results.push({ engine, action, passed: false, error: String(error) })
                    console.error(`${engine}: ${action}: ${error}`)
                    await page.screenshot({ path: `browser-results/${engine}-anchored-${action}-failed.png` })
                }
            }
            assert.deepEqual(errors, []); assert.deepEqual(external, [])
            await context.close()
        } finally { await browser.close() }
    }
} finally {
    server.kill("SIGTERM")
    await writeFile("browser-results/anchored-popup-lifetime.json", JSON.stringify({ results, limits: "Actual iframe removal/navigation/reload and real AnchoredPopup. Persisted page transitions are simulated; synthetic local data, no authenticated or physical-device evidence." }, null, 2))
}
assert.equal(results.length, (selected.length || 2) * 8)
assert(results.every(result => result.passed), "Anchored popup lifetime regression failed")
