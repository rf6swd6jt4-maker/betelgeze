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
        let acceptDialog = false
        page.on("dialog", dialog => acceptDialog ? dialog.accept() : dialog.dismiss())
        const surface = () => page.locator("[data-mobile-conversation-surface]:not([hidden])")
        const editor = () => surface().locator("[data-chat-composer]")
        const message = id => surface().locator(`[data-message-interaction="${id}"]`)
        const popup = () => page.locator("[data-anchored-popup]")
        const check = async (name, callback) => {
            try { await callback(); results.push({ engine, name, passed: true }); console.log(`${engine}: ${name}`) }
            catch (error) {
                results.push({ engine, name, passed: false, error: String(error) })
                await page.screenshot({ path: `browser-results/${engine}-comms-action-failure.png` })
                throw error
            }
        }
        async function open(mode) {
            await page.goto(origin)
            if (mode === "client") await page.getByRole("tab", { name: "Clients", exact: true }).click()
            await page.getByText(mode === "team" ? "Project team" : "Northstar Studio", { exact: true }).click()
            await page.waitForFunction(() => document.querySelector("[data-mobile-conversation-surface]:not([hidden])")?.dataset.phase === "open")
            // Delay/failure gates wrap only the preview's browser-local fetch.
            await page.evaluate(() => {
                window.actionComposer = document.querySelector("[data-mobile-conversation-surface]:not([hidden]) [data-chat-composer]")
                const localFetch = window.fetch
                window.actionGate = { match: "", method: "POST", fail: false, delay: 0, requests: 0 }
                window.fetch = async (input, init) => {
                    const gate = window.actionGate
                    if (gate.match && String(input).includes(gate.match) && (init?.method ?? "GET") === gate.method) {
                        gate.requests++
                        await new Promise(resolve => setTimeout(resolve, gate.delay))
                        if (gate.fail) return new Response(JSON.stringify({ error: "Synthetic action rejected" }), { status: 400, headers: { "Content-Type": "application/json" } })
                    }
                    return localFetch(input, init)
                }
            })
        }
        async function actionMenu(id) {
            const bubble = message(id).locator("[data-message-bubble]")
            await bubble.scrollIntoViewIfNeeded()
            await bubble.click({ button: "right" })
            await popup().waitFor({ state: "visible" })
        }
        async function geometry() {
            return surface().evaluate(surface => {
                const bounds = node => { const r = node.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, height: r.height } }
                return { surface: bounds(surface), header: bounds(surface.querySelector("[data-native-chat-viewport] > header")), composer: bounds(surface.querySelector("[data-composer-slot]")), scrollY: window.scrollY }
            })
        }
        async function assertStable() {
            const value = await geometry()
            assert(Math.abs(value.header.top) < 1, `Header moved: ${JSON.stringify(value)}`)
            assert.equal(value.scrollY, 0)
            assert.equal(await editor().evaluate(node => node === window.actionComposer), true, "Composer remounted during an action")
            assert(value.composer.bottom <= value.surface.bottom + 1)
            assert(await surface().evaluate(surface => {
                const r = surface.getBoundingClientRect()
                return [[r.left + 2, r.top + 2], [r.right - 2, r.bottom - 2], [(r.left + r.right) / 2, (r.top + r.bottom) / 2]].every(([x, y]) => {
                    const hit = document.elementFromPoint(x, y)
                    return hit && (surface.contains(hit) || hit.closest("[data-anchored-popup]"))
                })
            }), "Background UI received a hit through the active chat")
        }
        async function latestGap() {
            return surface().evaluate(surface => {
                const pane = surface.querySelector("[data-message-pane]")
                return surface.querySelector("[data-composer-slot]").getBoundingClientRect().top - pane.firstElementChild.getBoundingClientRect().bottom
            })
        }
        async function anchorSnapshot(id) {
            return message(id).evaluate(row => {
                const pane = row.closest("[data-message-pane]")
                return { id: row.dataset.messageInteraction, bottom: pane.getBoundingClientRect().bottom - row.getBoundingClientRect().bottom, paneHeight: pane.clientHeight, scroll: pane.scrollTop, content: pane.scrollHeight, rowTop: row.getBoundingClientRect().top, composerTop: document.querySelector("[data-mobile-conversation-surface]:not([hidden]) [data-composer-slot]").getBoundingClientRect().top }
            })
        }
        async function assertAnchor(snapshot) {
            const after = await anchorSnapshot(snapshot.id)
            assert(Math.abs(after.bottom - snapshot.bottom) < 2, `Reading anchor moved: ${JSON.stringify({ before: snapshot, after })}`)
        }
        async function gate(match, { fail = false, delay = 350, method = "POST" } = {}) {
            await page.evaluate(config => Object.assign(window.actionGate, config, { requests: 0 }), { match, fail, delay, method })
        }
        for (const mode of ["team", "client"]) {
            await open(mode)
            const id = mode === "team" ? "preview-team-message-47" : "preview-client-0-message-21"
            await check(`${mode}: roster opens above chat and restores focus without moving header`, async () => {
                const trigger = surface().getByRole("button", { name: mode === "team" ? "View Project team members" : "Client conversation participants", exact: true })
                await trigger.click()
                const dialog = surface().getByRole("dialog", { name: mode === "team" ? "Project team" : "Client conversation", exact: true })
                await dialog.waitFor()
                assert.equal(await dialog.evaluate(node => node.contains(document.activeElement)), true)
                await page.keyboard.press("Tab")
                assert.equal(await dialog.evaluate(node => node.contains(document.activeElement)), true)
                await page.keyboard.press("Escape")
                assert.equal(await dialog.count(), 0)
                await assertStable()
            })
            await check(`${mode}: touch hold opens once; release does not leak into another action`, async () => {
                const bubble = message(id).locator("[data-message-bubble]")
                await bubble.scrollIntoViewIfNeeded()
                await bubble.evaluate(node => {
                    const r = node.getBoundingClientRect()
                    const touch = { identifier: 1, target: node, clientX: r.left + 20, clientY: r.top + 20 }
                    const event = new Event("touchstart", { bubbles: true })
                    Object.assign(event, { touches: [touch], changedTouches: [touch] })
                    node.dispatchEvent(event)
                })
                await popup().waitFor({ state: "visible" })
                await bubble.evaluate(node => { const event = new Event("touchend", { bubbles: true }); Object.assign(event, { touches: [] }); node.dispatchEvent(event) })
                assert.equal(await popup().count(), 1)
                await page.keyboard.press("Escape")
                assert.equal(await popup().count(), 0)
                await assertStable()
            })
            await check(`${mode}: action and reaction menus stay inside small viewport`, async () => {
                await actionMenu(id)
                if (mode === "client") {
                    assert.equal(await popup().getByRole("button", { name: "Edit message" }).count(), 0)
                    assert.equal(await popup().getByRole("button", { name: "Delete message" }).count(), 0)
                }
                await page.setViewportSize({ width: 320, height: 440 })
                await pause(100)
                const rect = await popup().boundingBox()
                assert(rect.x >= 7 && rect.x + rect.width <= 313 && rect.y >= 7 && rect.y + rect.height <= 433, JSON.stringify(rect))
                await popup().getByRole("button", { name: "React to message" }).click()
                await popup().getByRole("button", { name: "Use device emoji picker" }).click()
                assert.equal(await page.getByRole("textbox", { name: "Emoji reaction" }).evaluate(node => node === document.activeElement), true)
                await page.getByRole("textbox", { name: "Emoji reaction" }).fill("two")
                await popup().getByRole("button", { name: "React", exact: true }).click()
                await page.getByText("Choose one emoji.", { exact: true }).waitFor()
                await page.keyboard.press("Escape")
                assert.equal(await popup().count(), 0)
                await page.setViewportSize({ width: 390, height: 844 })
                await pause(400)
                await assertStable()
            })
            await check(`${mode}: delayed custom reaction shows promptly and failed replacement recovers`, async () => {
                const gap = await latestGap()
                await gate("/reactions")
                await actionMenu(id)
                await popup().getByRole("button", { name: "React to message" }).click()
                await popup().getByRole("button", { name: "Use device emoji picker" }).click()
                await page.getByRole("textbox", { name: "Emoji reaction" }).fill("🎯")
                await popup().getByRole("button", { name: "React", exact: true }).click()
                await surface().getByText("🎯", { exact: true }).last().waitFor()
                assert.equal(await popup().count(), 0)
                await pause(450)
                assert(Math.abs(await latestGap() - gap) < 2, "Reaction changed the newest-message/composer gap")
                assert.equal(await page.evaluate(() => window.actionGate.requests), 1)
                await gate("/reactions", { fail: true })
                await actionMenu(id)
                await popup().getByRole("button", { name: "React to message" }).click()
                await popup().getByRole("button", { name: "React with 👍" }).click()
                await page.getByText("Synthetic action rejected", { exact: true }).waitFor()
                await surface().getByText("🎯", { exact: true }).last().waitFor()
                assert(Math.abs(await latestGap() - gap) < 2, "Rejected reaction changed the newest-message/composer gap")
                await assertStable()
            })
            await check(`${mode}: reply/quote and sticker accessories preserve draft and containment`, async () => {
                await editor().fill("Retained synthetic draft")
                await actionMenu(id)
                const anchor = await anchorSnapshot(id)
                await popup().getByRole("button", { name: mode === "team" ? "Quote" : "Reply", exact: true }).click()
                await surface().getByRole("button", { name: "Cancel reply" }).waitFor()
                assert.equal(await editor().textContent(), "Retained synthetic draft")
                await pause(250)
                const during = await anchorSnapshot(id)
                await surface().getByRole("button", { name: "Cancel reply" }).click()
                await pause(250)
                try { await assertAnchor(anchor) } catch (error) { throw Error(`${error.message}; during=${JSON.stringify(during)}`) }
                await surface().getByRole("button", { name: "Open sticker tray" }).click()
                await surface().getByRole("button", { name: "Close sticker tray" }).waitFor()
                await assertStable()
                await surface().getByRole("button", { name: "Close sticker tray" }).click()
                assert.equal(await editor().textContent(), "Retained synthetic draft")
                await editor().press("Home")
                await editor().press("Shift+ArrowRight")
                await editor().press("Shift+ArrowRight")
                assert.equal(await page.evaluate(() => getSelection()?.toString()), "Re", "Composer selection no longer works after accessories")
            })
            await check(`${mode}: pin updates its bar and unpin restores layout`, async () => {
                await gate("/pins")
                await actionMenu(id)
                await popup().getByRole("button", { name: "Pin message", exact: true }).click()
                await pause(450)
                await surface().getByRole("button", { name: /^Jump to pinned message:/ }).waitFor()
                await actionMenu(id)
                await popup().getByRole("button", { name: "Unpin message", exact: true }).click()
                await pause(450)
                assert.equal(await surface().getByRole("button", { name: /^Jump to pinned message:/ }).count(), 0)
                await assertStable()
            })
            await check(`${mode}: attachment removal and media gallery leave the chat usable`, async () => {
                await editor().fill("")
                const file = { name: "synthetic-image.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+X7yoAAAAASUVORK5CYII=", "base64") }
                const input = surface().locator('input[type="file"]').first()
                await input.setInputFiles(file)
                await surface().getByRole("button", { name: "Remove synthetic-image.png" }).click()
                assert.equal(await surface().getByRole("button", { name: "Remove synthetic-image.png" }).count(), 0)
                await input.setInputFiles(file)
                await surface().getByRole("button", { name: "Send message" }).click()
                await surface().getByRole("button", { name: "Open synthetic-image.png" }).last().click()
                await page.getByRole("dialog", { name: "Image preview", exact: true }).waitFor()
                assert.equal(await page.getByRole("dialog", { name: "Image preview", exact: true }).evaluate(node => node.contains(document.activeElement)), true)
                await page.keyboard.press("Tab")
                assert.equal(await page.getByRole("dialog", { name: "Image preview", exact: true }).evaluate(node => node.contains(document.activeElement)), true, "Tab escaped the gallery")
                assert.equal(await page.getByRole("dialog", { name: "Image preview", exact: true }).evaluate(dialog => {
                    // Native shadow controls report their owning video as the
                    // event target. Verify the real gallery handler lets that
                    // default traversal continue; no media download is needed.
                    const video = document.createElement("video")
                    video.controls = true
                    dialog.append(video)
                    const event = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true })
                    video.dispatchEvent(event)
                    video.remove()
                    return event.defaultPrevented
                }), false, "Gallery intercepted native media control traversal")
                await page.getByRole("button", { name: "Close image preview" }).click()
                assert.equal(await page.getByRole("dialog", { name: "Image preview", exact: true }).count(), 0)
                await editor().fill("Still usable")
                await assertStable()
            })
            if (mode === "team") {
                await check("team: edit failure retains input; acknowledgement restores previous draft", async () => {
                    const ownId = "preview-team-message-46"
                    await editor().fill("Preserve this draft")
                    await actionMenu(ownId)
                    await popup().getByRole("button", { name: "Edit message", exact: true }).click()
                    await surface().getByRole("button", { name: "Cancel editing" }).click()
                    assert.equal(await editor().textContent(), "Preserve this draft")
                    await assertStable()
                    await actionMenu(ownId)
                    await popup().getByRole("button", { name: "Edit message", exact: true }).click()
                    await editor().fill("Synthetic edited text")
                    await gate("/messages", { fail: true, method: "PATCH" })
                    await surface().getByRole("button", { name: "Save edit", exact: true }).click()
                    assert.equal(await surface().getByRole("button", { name: "Save edit", exact: true }).isDisabled(), true)
                    await page.getByText("Synthetic action rejected", { exact: true }).waitFor()
                    assert.equal(await editor().textContent(), "Synthetic edited text")
                    await gate("/messages", { method: "PATCH" })
                    await surface().getByRole("button", { name: "Save edit", exact: true }).click()
                    await surface().getByRole("button", { name: "Send message", exact: true }).waitFor()
                    assert.equal(await editor().textContent(), "Preserve this draft")
                    await message(ownId).getByText("Synthetic edited text", { exact: true }).waitFor()
                    await assertStable()
                })
                await check("team: cancel deletion sends nothing; failed deletion restores; confirmed deletion removes", async () => {
                    await gate("/messages", { method: "DELETE" })
                    await actionMenu(id)
                    await popup().getByRole("button", { name: "Delete message", exact: true }).click()
                    assert.equal(await page.evaluate(() => window.actionGate.requests), 0)
                    assert.equal(await message(id).count(), 1)
                    acceptDialog = true
                    await gate("/messages", { fail: true, method: "DELETE" })
                    await popup().getByRole("button", { name: "Delete message", exact: true }).click()
                    await page.getByText("Synthetic action rejected", { exact: true }).waitFor()
                    await message(id).waitFor()
                    await gate("/messages", { method: "DELETE" })
                    await actionMenu(id)
                    await popup().getByRole("button", { name: "Delete message", exact: true }).click()
                    await pause(450)
                    assert.equal(await message(id).count(), 0)
                    acceptDialog = false
                    await assertStable()
                })
            }
            await check(`${mode}: returning to list removes portal menus and preserves draft`, async () => {
                await editor().fill("Draft after actions")
                const last = surface().locator("[data-message-bubble]").last()
                await last.scrollIntoViewIfNeeded()
                await last.click({ button: "right" })
                await surface().getByRole("button", { name: mode === "team" ? "Back to team conversations" : "Back to client chats", exact: true }).click()
                await page.waitForFunction(() => !document.querySelector("[data-mobile-conversation-surface]:not([hidden])"))
                assert.equal(await popup().count(), 0)
                await page.getByText(mode === "team" ? "Project team" : "Northstar Studio", { exact: true }).click()
                await page.waitForFunction(() => document.querySelector("[data-mobile-conversation-surface]:not([hidden])")?.dataset.phase === "open")
                assert.equal(await editor().textContent(), "Draft after actions")
                await editor().evaluate(node => { window.actionComposer = node })
                await assertStable()
            })
            await check(`${mode}: reacting while reading history retains its visible anchor`, async () => {
                const visible = await surface().locator("[data-message-pane]").evaluate(pane => {
                    pane.dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY: -620 }))
                    pane.scrollBy({ top: -620, behavior: "instant" })
                    return new Promise(resolve => setTimeout(() => {
                        const rect = pane.getBoundingClientRect()
                        resolve([...pane.querySelectorAll("[data-message-interaction]")]
                            .filter(row => { const r = row.getBoundingClientRect(); return r.top > rect.top + 8 && r.bottom < rect.bottom - 8 })
                            .map(row => row.dataset.messageInteraction))
                    }, 260))
                })
                assert(visible.length >= 2, "Fixture needs two fully visible history messages")
                const anchor = await anchorSnapshot(visible[0])
                await gate("/reactions")
                await actionMenu(visible[1])
                await popup().getByRole("button", { name: "React to message" }).click()
                await popup().getByRole("button", { name: "React with 👍" }).click()
                await pause(450)
                await assertAnchor(anchor)
                await assertStable()
            })
        }
        assert.deepEqual(errors, [], "Browser exceptions")
        assert.deepEqual(external, [], "External requests")
        await context.close()
        await browser.close()
    }
} finally {
    server.kill("SIGTERM")
    await writeFile("browser-results/fullscreen-comms-actions.json", JSON.stringify({ observedAt: new Date().toISOString(), results, limits: "Synthetic Team and Client UI in browser engines. Keyboard animation, touch selection, OS file/emoji pickers, production mutation and provider delivery require separate physical/authenticated checks." }, null, 2))
}
