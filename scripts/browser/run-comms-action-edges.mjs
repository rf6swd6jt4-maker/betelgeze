// Rare UI lifecycle checks in the real workspaces, using synthetic local I/O.
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
await mkdir("browser-results", { recursive: true })
const results = []
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
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
            const editor = () => surface().locator("[data-chat-composer]")
            const popup = () => page.locator("[data-message-action-popup]")
            const row = id => surface().locator(`[data-message-interaction="${id}"]`)
            async function open(mode = "team") {
                await page.setViewportSize({ width: 390, height: 844 })
                await page.goto(origin)
                if (mode === "client") await page.getByRole("tab", { name: "Clients", exact: true }).click()
                await choose(mode === "team" ? "Project team" : "Northstar Studio")
                await page.evaluate(() => {
                    const fetchLocal = window.fetch
                    window.edgeRequests = []
                    window.fetch = async (input, init) => {
                        if (init?.method !== "PATCH") return fetchLocal(input, init)
                        let release
                        const result = new Promise(resolve => { release = resolve })
                        const request = { release, done: false }
                        window.edgeRequests.push(request)
                        const fail = await result
                        const response = fail ? new Response(JSON.stringify({ error: "Stale edit rejected" }), { status: 400, headers: { "Content-Type": "application/json" } }) : await fetchLocal(input, init)
                        request.done = true
                        return response
                    }
                })
            }
            async function choose(name) {
                await page.getByText(name, { exact: true }).click()
                await page.waitForFunction(() => document.querySelector("[data-mobile-conversation-surface]:not([hidden])")?.dataset.phase === "open")
            }
            async function back() {
                await surface().locator("[data-mobile-conversation-back]").click()
                await page.waitForFunction(() => !document.querySelector("[data-mobile-conversation-surface]:not([hidden])"))
            }
            async function menu(id) {
                const bubble = row(id).locator("[data-message-bubble]")
                await bubble.scrollIntoViewIfNeeded(); await bubble.click({ button: "right" })
                await popup().waitFor({ state: "visible" })
            }
            async function startSave(body = "Pending synthetic edit") {
                await menu("preview-team-message-46")
                await popup().getByRole("button", { name: "Edit message", exact: true }).click()
                await editor().fill(body)
                await surface().getByRole("button", { name: "Save edit", exact: true }).click()
                await page.waitForFunction(() => window.edgeRequests.length > 0)
            }
            async function release(index, fail = false) {
                await page.evaluate(({ index, fail }) => window.edgeRequests[index].release(fail), { index, fail })
                await page.waitForFunction(index => window.edgeRequests[index]?.done, index)
                await pause(100)
            }
            async function deleted(mode, id, pending = false) {
                await page.evaluate(async ({ mode, id }) => {
                    const path = mode === "team" ? "native/messages?conversationId=preview-team" : "messages?relationshipId=preview-client-0"
                    await fetch(`/api/workspaces/local-preview/communications/${path}&messageId=${id}`, { method: "DELETE" })
                    window.dispatchEvent(new CustomEvent("preview:realtime", { detail: {
                        kind: "postgres_changes", table: mode === "team" ? "workspace_native_messages" : "client_messages", payload: { eventType: "DELETE", old: { id } },
                    } }))
                }, { mode, id })
                // The existing mutation coordinator can retain its pending
                // optimistic row. This test only owns the edit UI lifecycle.
                if (!pending) await row(id).waitFor({ state: "detached" })
            }
            async function stable() {
                const geometry = await surface().evaluate(node => ({ header: node.querySelector("[data-native-chat-viewport] > header").getBoundingClientRect().top, scroll: scrollY, focusedEditor: document.activeElement?.matches("[data-chat-composer]") }))
                assert(Math.abs(geometry.header) < 1 && geometry.scroll === 0, JSON.stringify(geometry))
            }
            async function check(name, run) {
                try { await run(); results.push({ engine, name, passed: true }); console.log(`${engine}: ${name}`) }
                catch (error) { results.push({ engine, name, passed: false, error: String(error) }); await page.screenshot({ path: `browser-results/${engine}-comms-action-edge-failure.png` }); throw error }
            }

            for (const fail of [false, true]) {
                await check(`late edit ${fail ? "failure" : "success"} cannot overwrite typing after cancel`, async () => {
                    await open(); await editor().fill("Original draft")
                    await startSave()
                    await surface().getByRole("button", { name: "Cancel editing", exact: true }).click()
                    await editor().fill("New draft after cancellation")
                    await release(0, fail)
                    assert.equal(await editor().textContent(), "New draft after cancellation")
                    assert.equal(await page.getByText("Stale edit rejected", { exact: true }).count(), 0)
                    assert.equal(await surface().getByRole("button", { name: "Cancel editing", exact: true }).count(), 0)
                    await stable()
                })
                await check(`late edit ${fail ? "failure" : "success"} cannot change A → B → A editor`, async () => {
                    await open(); await editor().fill("Original draft")
                    await startSave()
                    await back(); await choose("Alex Morgan"); await back(); await choose("Project team")
                    await editor().fill("Draft after return")
                    await release(0, fail)
                    assert.equal(await editor().textContent(), "Draft after return")
                    assert.equal(await page.getByText("Stale edit rejected", { exact: true }).count(), 0)
                    await stable()
                })
            }
            await check("earlier completion cannot dismiss or enable a newer pending edit", async () => {
                await open(); await editor().fill("Original draft")
                await startSave("First pending edit")
                await surface().getByRole("button", { name: "Cancel editing", exact: true }).click()
                await menu("preview-team-message-46")
                await popup().getByRole("button", { name: "Edit message", exact: true }).click()
                await editor().fill("Second pending edit")
                await surface().getByRole("button", { name: "Save edit", exact: true }).click()
                await release(0)
                await page.waitForFunction(() => window.edgeRequests.length === 2)
                assert.equal(await editor().textContent(), "Second pending edit")
                assert.equal(await surface().getByRole("button", { name: "Save edit", exact: true }).isDisabled(), true)
                await release(1)
                await surface().getByRole("button", { name: "Send message", exact: true }).waitFor()
                assert.equal(await editor().textContent(), "Original draft")
                await stable()
            })
            await check("target removal retires only its edit UI session", async () => {
                await open(); await editor().fill("Original draft"); await startSave()
                await deleted("team", "preview-team-message-46", true)
                await surface().getByRole("button", { name: "Cancel editing", exact: true }).waitFor({ state: "detached" })
                assert.equal(await surface().getByRole("button", { name: "Cancel editing", exact: true }).count(), 0)
                await editor().fill("Draft after target removal")
                await release(0, true)
                assert.equal(await editor().textContent(), "Draft after target removal")
                assert.equal(await page.getByText("Stale edit rejected", { exact: true }).count(), 0)
            })
            for (const mode of ["team", "client"]) {
                const id = mode === "team" ? "preview-team-message-47" : "preview-client-0-message-21"
                await check(`${mode}: popup opening retires an active keyboard tween before placement`, async () => {
                    await open(mode)
                    await editor().focus()
                    await page.evaluate(() => {
                        window.edgeViewportHeight = 510
                        Object.defineProperty(visualViewport, "height", { configurable: true, get: () => window.edgeViewportHeight })
                        visualViewport.dispatchEvent(new Event("resize"))
                    })
                    await pause(360)
                    await page.evaluate(() => { window.edgeViewportHeight = 844; visualViewport.dispatchEvent(new Event("resize")) })
                    await pause(70)
                    assert.equal(await surface().locator("[data-chat-motion-layer]").evaluate(node => node.getAnimations().some(animation => animation.playState === "running")), true, "No active tween in fixture")
                    await row(id).locator("[data-message-bubble]").evaluate(node => {
                        const r = node.getBoundingClientRect()
                        node.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2, clientX: r.left + 20, clientY: r.top + 20 }))
                    })
                    await popup().waitFor({ state: "visible" })
                    assert.equal(await surface().locator("[data-chat-motion-layer]").evaluate(node => node.getAnimations().some(animation => animation.playState === "running")), false)
                    const before = await row(id).boundingBox(), menuTop = await page.locator("[data-anchored-popup]").evaluate(node => parseFloat(node.style.top))
                    await pause(340)
                    const after = await row(id).boundingBox(), menuAfter = await page.locator("[data-anchored-popup]").boundingBox(), finalMenuTop = await page.locator("[data-anchored-popup]").evaluate(node => parseFloat(node.style.top))
                    // The popup has its own intentional 4px entry animation;
                    // its anchor-derived placement must remain unchanged.
                    assert(Math.abs(after.y - before.y) < 1 && Math.abs(finalMenuTop - menuTop) < 1, JSON.stringify({ before, after, menuTop, finalMenuTop }))
                    assert(menuAfter.y >= 7 && menuAfter.y + menuAfter.height <= 837 && menuAfter.x >= 7 && menuAfter.x + menuAfter.width <= 383)
                    await stable()
                })
                await check(`${mode}: removed popup/quote targets leave no stale overlay`, async () => {
                    await open(mode); await menu(id); await deleted(mode, id)
                    assert.equal(await popup().count(), 0)
                    const other = mode === "team" ? "preview-team-message-46" : "preview-client-0-message-20"
                    await menu(other)
                    await popup().getByRole("button", { name: mode === "team" ? "Quote" : "Reply", exact: true }).click()
                    await surface().getByRole("button", { name: "Cancel reply" }).waitFor()
                    await deleted(mode, other)
                    assert.equal(await surface().getByRole("button", { name: "Cancel reply" }).count(), 0)
                    await editor().fill("Draft remains usable")
                    await stable()
                })
                await check(`${mode}: rotated custom picker dismisses fully on back/reopen`, async () => {
                    await open(mode); await menu(id)
                    await popup().getByRole("button", { name: "React to message", exact: true }).click()
                    await popup().getByRole("button", { name: "Use device emoji picker" }).click()
                    await page.getByRole("textbox", { name: "Emoji reaction" }).fill("🎯")
                    await page.setViewportSize({ width: 844, height: 390 })
                    await pause(100)
                    const r = await page.locator("[data-anchored-popup]").boundingBox()
                    assert(r.x >= 7 && r.y >= 7 && r.x + r.width <= 837 && r.y + r.height <= 383, JSON.stringify(r))
                    await back()
                    assert.equal(await page.locator("[data-anchored-popup]").count(), 0)
                    await choose(mode === "team" ? "Project team" : "Northstar Studio")
                    assert.equal(await page.getByRole("textbox", { name: "Emoji reaction" }).count(), 0)
                    await stable()
                })
                await check(`${mode}: sticker accessories do not leak into another chat`, async () => {
                    await open(mode)
                    await surface().getByRole("button", { name: "Open sticker tray" }).click()
                    await back()
                    await choose(mode === "team" ? "New project" : "Harbour Coffee")
                    assert.equal(await surface().getByRole("button", { name: "Close sticker tray" }).count(), 0)
                    await stable()
                })
                await check(`${mode}: quick gallery close/departure releases overlay and focus`, async () => {
                    await open(mode)
                    await surface().locator('input[type="file"]').first().setInputFiles({ name: "edge-image.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+X7yoAAAAASUVORK5CYII=", "base64") })
                    await surface().getByRole("button", { name: "Send message", exact: true }).click()
                    await surface().getByRole("button", { name: "Open edge-image.png", exact: true }).click()
                    await page.getByRole("dialog", { name: "Image preview", exact: true }).waitFor()
                    await page.evaluate(() => {
                        document.querySelector('[aria-label="Close image preview"]').click()
                        document.querySelector("[data-mobile-conversation-surface]:not([hidden]) [data-mobile-conversation-back]").click()
                    })
                    await page.waitForFunction(() => !document.querySelector("[data-mobile-conversation-surface]:not([hidden])"))
                    assert.equal(await page.getByRole("dialog", { name: "Image preview", exact: true }).count(), 0)
                    assert.equal(await page.evaluate(() => document.activeElement?.matches("[data-chat-composer]")), false)
                    await choose(mode === "team" ? "Project team" : "Northstar Studio")
                    assert.equal(await page.getByRole("dialog", { name: "Image preview", exact: true }).count(), 0)
                    await editor().fill("Reopened without an overlay")
                    await stable()
                })
            }
            assert.deepEqual(errors, []); assert.deepEqual(external, [])
            await context.close()
        } finally { await browser.close() }
    }
} finally {
    server.kill("SIGTERM")
    await writeFile("browser-results/comms-action-edges.json", JSON.stringify({ observedAt: new Date().toISOString(), results, limits: "Synthetic acknowledgements and local event injection into actual UI callbacks. Not physical-device keyboard/native controls, provider, or production synchronization evidence." }, null, 2))
}
