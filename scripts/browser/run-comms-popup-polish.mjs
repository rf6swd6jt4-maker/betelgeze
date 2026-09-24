// Actual Comms controls with browser-local synthetic data and delivery disabled.
import { spawn } from "node:child_process"
import { mkdir, writeFile } from "node:fs/promises"
import assert from "node:assert/strict"
import { chromium, webkit } from "playwright"

const selected = process.argv.slice(2)
if (selected.some(name => !["chromium", "webkit"].includes(name))) throw Error("Use chromium and/or webkit")
const server = spawn(process.execPath, ["scripts/serve-fullscreen-comms-preview.mjs", "--host", "127.0.0.1", "--port", "0"], { stdio: ["ignore", "pipe", "pipe"] })
const origin = await new Promise((resolve, reject) => {
    let output = ""
    const timer = setTimeout(() => reject(Error(output || "Preview startup timed out")), 90_000)
    const receive = chunk => {
        output = (output + chunk).slice(-12_000)
        const match = output.match(/http:\/\/localhost:(\d+)\//)
        if (match) { clearTimeout(timer); resolve(`http://127.0.0.1:${match[1]}`) }
    }
    server.stdout.on("data", receive); server.stderr.on("data", receive)
    server.once("exit", code => { clearTimeout(timer); reject(Error(`Preview ${code}: ${output}`)) })
})
const results = []
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
await mkdir("browser-results", { recursive: true })
try {
    for (const engine of selected.length ? selected : ["chromium", "webkit"]) {
        const browser = await ({ chromium, webkit })[engine].launch()
        try {
            const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
            const errors = [], external = []
            await context.route("**/*", route => {
                const url = new URL(route.request().url())
                if (url.origin === origin || ["blob:", "data:"].includes(url.protocol)) return route.continue()
                external.push(url.origin); return route.abort()
            })
            const page = await context.newPage()
            page.on("pageerror", error => errors.push(error.message))
            const surface = () => page.locator("[data-mobile-conversation-surface]:not([hidden])")
            async function open(mode) {
                await page.goto(origin)
                if (mode === "client") await page.getByRole("tab", { name: "Clients", exact: true }).click()
                await page.getByText(mode === "team" ? "Project team" : "Northstar Studio", { exact: true }).click()
                await page.waitForFunction(() => document.querySelector("[data-mobile-conversation-surface]:not([hidden])")?.dataset.phase === "open")
            }
            async function check(name, run) {
                try { await run(); results.push({ engine, name, passed: true }); console.log(`${engine}: ${name}`) }
                catch (error) {
                    results.push({ engine, name, passed: false, error: String(error) })
                    console.error(`${engine}: ${name}: ${error}`)
                    await page.screenshot({ path: `browser-results/${engine}-comms-popup-polish-failure.png` })
                }
            }
            for (const mode of ["team", "client"]) {
                await check(`${mode}: message and custom reaction popup stay outside simulated device cutouts`, async () => {
                    await open(mode)
                    await page.addStyleTag({ content: '[data-anchored-popup]{--anchored-popup-safe-left:59px!important;--anchored-popup-safe-right:44px!important;--anchored-popup-safe-top:44px!important;--anchored-popup-safe-bottom:34px!important}' })
                    const id = mode === "team" ? "preview-team-message-47" : "preview-client-0-message-21"
                    const bubble = surface().locator(`[data-message-interaction="${id}"] [data-message-bubble]`)
                    await bubble.scrollIntoViewIfNeeded()
                    await bubble.evaluate(node => {
                        const box = node.getBoundingClientRect()
                        node.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2, clientX: box.left + 16, clientY: box.top + 16 }))
                    })
                    const popup = page.locator("[data-anchored-popup]")
                    await popup.waitFor({ state: "visible" }); await pause(180)
                    const checkBounds = async () => {
                        const box = await popup.boundingBox()
                        assert(box.x >= 66 && box.y >= 51 && box.x + box.width <= 339 && box.y + box.height <= 803, JSON.stringify(box))
                    }
                    await checkBounds()
                    await popup.getByRole("button", { name: "React to message", exact: true }).click()
                    await popup.getByRole("button", { name: "Use device emoji picker" }).click()
                    await pause(180)
                    await checkBounds()
                    await page.keyboard.press("Escape")
                    await popup.waitFor({ state: "detached" })
                })
                await check(`${mode}: closing the custom reaction form clears its retired validation`, async () => {
                    await open(mode)
                    const id = mode === "team" ? "preview-team-message-47" : "preview-client-0-message-21"
                    const bubble = surface().locator(`[data-message-interaction="${id}"] [data-message-bubble]`)
                    await bubble.scrollIntoViewIfNeeded(); await bubble.click({ button: "right" })
                    const popup = page.locator("[data-message-action-popup]")
                    await popup.getByRole("button", { name: "React to message", exact: true }).click()
                    const toggle = popup.getByRole("button", { name: "Use device emoji picker" })
                    await toggle.click()
                    await popup.getByRole("textbox", { name: "Emoji reaction" }).fill("invalid")
                    await popup.getByRole("button", { name: "React", exact: true }).click()
                    await popup.getByText("Choose one emoji.", { exact: true }).waitFor()
                    await toggle.click(); await toggle.click()
                    assert.equal(await popup.getByRole("textbox", { name: "Emoji reaction" }).inputValue(), "")
                    assert.equal(await popup.getByText("Choose one emoji.", { exact: true }).count(), 0)
                    await popup.getByRole("textbox", { name: "Emoji reaction" }).fill("🎯")
                    await popup.getByRole("button", { name: "React", exact: true }).click()
                    await popup.waitFor({ state: "detached" })
                })
                if (mode === "team") await check(`${mode}: interrupted gallery capture returns the strip and allows the next swipe`, async () => {
                    await open(mode)
                    const buffer = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+X7yoAAAAASUVORK5CYII=", "base64")
                    await surface().locator('input[type="file"]').first().setInputFiles([
                        { name: "first.png", mimeType: "image/png", buffer },
                        { name: "second.png", mimeType: "image/png", buffer },
                    ])
                    await surface().getByRole("button", { name: "Send message", exact: true }).click()
                    await surface().getByRole("button", { name: "Open first.png", exact: true }).click()
                    const gallery = page.getByRole("dialog", { name: "Image preview", exact: true })
                    await gallery.waitFor()
                    const viewport = gallery.locator("[data-media-gallery-viewport]")
                    const bounds = await viewport.boundingBox()
                    await viewport.evaluate(node => node.addEventListener("pointerdown", event => { window.galleryPointerId = event.pointerId }, { once: true }))
                    await page.mouse.move(bounds.x + bounds.width * 0.7, bounds.y + bounds.height * 0.5)
                    await page.mouse.down()
                    await page.mouse.move(bounds.x + bounds.width * 0.3, bounds.y + bounds.height * 0.5, { steps: 5 })
                    assert.equal(await viewport.evaluate(node => node.hasPointerCapture(window.galleryPointerId)), true)
                    assert.equal(await viewport.evaluate(node => node.firstElementChild.style.transition), "none")
                    await viewport.evaluate(node => node.releasePointerCapture(window.galleryPointerId))
                    // A new pointer event causes the UA to flush lostpointercapture.
                    await page.mouse.move(bounds.x + bounds.width * 0.29, bounds.y + bounds.height * 0.5)
                    await pause(250)
                    assert.equal(await viewport.evaluate(node => node.firstElementChild.style.transition), "")
                    assert.equal(await viewport.evaluate(node => node.firstElementChild.style.transform), "translate3d(0%, 0px, 0px)")
                    await page.mouse.up()
                    assert.equal(await gallery.getByRole("button", { name: "Previous media" }).isDisabled(), true)
                    await page.mouse.move(bounds.x + bounds.width * 0.7, bounds.y + bounds.height * 0.5)
                    await page.mouse.down()
                    await page.mouse.move(bounds.x + bounds.width * 0.25, bounds.y + bounds.height * 0.5, { steps: 5 })
                    await page.mouse.up()
                    await pause(250)
                    assert.equal(await gallery.getByRole("button", { name: "Next media" }).isDisabled(), true)
                    await gallery.getByRole("button", { name: "Close image preview" }).click()
                })
            }
            for (const failed of [false, true]) await check(`client: late participant-save ${failed ? "error" : "success"} cannot change a reopened roster`, async () => {
                await open("client")
                await page.evaluate(() => {
                    const fetchLocal = window.fetch
                    window.fetch = (input, init) => {
                        if (!String(input).endsWith("/communications/participants")) return fetchLocal(input, init)
                        return new Promise(resolve => { window.releaseParticipantSave = failed => resolve(new Response(JSON.stringify(failed ? { error: "Old participant save failed" } : {}), { status: failed ? 400 : 200, headers: { "Content-Type": "application/json" } })) })
                    }
                })
                const trigger = surface().getByRole("button", { name: "Client conversation participants", exact: true })
                const dialog = surface().getByRole("dialog", { name: "Client conversation", exact: true })
                await trigger.click()
                await dialog.getByRole("button", { name: "Save participants", exact: true }).click()
                await page.waitForFunction(() => typeof window.releaseParticipantSave === "function")
                await dialog.getByRole("button", { name: "Close participants", exact: true }).click()
                await trigger.click()
                await page.evaluate(failed => window.releaseParticipantSave(failed), failed)
                await dialog.getByRole("button", { name: "Save participants", exact: true }).waitFor()
                assert.equal(await dialog.count(), 1)
                assert.equal(await dialog.getByText("Old participant save failed", { exact: true }).count(), 0)
                await dialog.getByRole("button", { name: "Close participants", exact: true }).click()
            })
            await check("client: inactive retained chat retires its participant roster", async () => {
                await open("client")
                await surface().getByRole("button", { name: "Client conversation participants", exact: true }).click()
                const dialog = page.getByRole("dialog", { name: "Client conversation", exact: true })
                await dialog.waitFor()
                // Invoke the real retained-tab owner; body datasets are only
                // the legacy visibility fallback in this native fixture.
                await page.getByRole("tab", { name: "Work", exact: true, includeHidden: true }).evaluate(node => node.click())
                await dialog.waitFor({ state: "detached" })
                await page.getByRole("tab", { name: "Comms", exact: true, includeHidden: true }).evaluate(node => node.click())
                await pause(350)
                assert.equal(await dialog.count(), 0)
            })
            assert.deepEqual(errors, []); assert.deepEqual(external, [])
            await context.close()
        } finally { await browser.close() }
    }
} finally {
    server.kill("SIGTERM")
    await writeFile("browser-results/comms-popup-polish.json", JSON.stringify({ observedAt: new Date().toISOString(), results, limits: "Synthetic real-component controls with local data and external delivery blocked; not physical-device gesture evidence." }, null, 2))
}
assert(results.every(result => result.passed), "Popup polish regression failed")
