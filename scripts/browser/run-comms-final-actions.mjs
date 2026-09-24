// Final UI-session regressions using the production workspaces and local synthetic I/O.
import { spawn } from "node:child_process"
import { mkdir, writeFile } from "node:fs/promises"
import assert from "node:assert/strict"
import { chromium, webkit } from "playwright"

const engines = process.argv.slice(2)
if (engines.some(name => !["chromium", "webkit"].includes(name))) throw Error("Use chromium and/or webkit")
const server = spawn(process.execPath, ["scripts/serve-fullscreen-comms-preview.mjs", "--host", "127.0.0.1", "--port", "0"], { stdio: ["ignore", "pipe", "pipe"] })
const origin = await new Promise((resolve, reject) => {
    let output = ""
    const timer = setTimeout(() => reject(Error(output || "Preview startup timed out")), 90_000)
    const receive = chunk => { output = (output + chunk).slice(-12_000); const match = output.match(/http:\/\/localhost:(\d+)\//); if (match) { clearTimeout(timer); resolve(`http://127.0.0.1:${match[1]}`) } }
    server.stdout.on("data", receive); server.stderr.on("data", receive)
    server.once("exit", code => { clearTimeout(timer); reject(Error(`Preview ${code}: ${output}`)) })
})
await mkdir("browser-results", { recursive: true })
const results = []
try {
    for (const engine of engines.length ? engines : ["chromium", "webkit"]) {
        const browser = await ({ chromium, webkit })[engine].launch()
        try {
            const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
            const external = []
            await context.route("**/*", route => {
                const url = new URL(route.request().url())
                if (url.origin === origin || ["blob:", "data:"].includes(url.protocol)) return route.continue()
                external.push(url.origin); return route.abort()
            })
            const page = await context.newPage()
            page.setDefaultTimeout(5000)
            let errors = []
            page.on("pageerror", error => errors.push(error.message))
            const surface = () => page.locator("[data-mobile-conversation-surface]:not([hidden])")
            const editor = () => surface().locator("[data-chat-composer]")
            const popup = () => page.locator("[data-message-action-popup]")
            const row = id => surface().locator(`[data-message-interaction="${id}"]`)
            async function choose(name) { await page.getByText(name, { exact: true }).click(); await page.waitForFunction(() => document.querySelector("[data-mobile-conversation-surface]:not([hidden])")?.dataset.phase === "open") }
            async function open(mode = "team") { errors = []; await page.goto(origin); if (mode === "client") await page.getByRole("tab", { name: "Clients", exact: true }).click(); await choose(mode === "team" ? "Project team" : "Northstar Studio") }
            async function back() { await surface().locator("[data-mobile-conversation-back]").click(); await page.waitForFunction(() => !document.querySelector("[data-mobile-conversation-surface]:not([hidden])")) }
            async function menu(id) { const bubble = row(id).locator("[data-message-bubble]"); await bubble.scrollIntoViewIfNeeded(); await bubble.click({ button: "right" }); await popup().waitFor({ state: "visible" }) }
            async function check(name, run) {
                try { await run(); assert.deepEqual(errors, []); results.push({ engine, name, passed: true }); console.log(`${engine}: PASS ${name}`) }
                catch (error) { results.push({ engine, name, passed: false, error: String(error) }); console.log(`${engine}: FAIL ${name}: ${error}`); await page.screenshot({ path: `browser-results/${engine}-comms-final-actions-${results.length}.png` }) }
            }
            await check("remote removal restores the pre-edit draft", async () => {
                await open(); await editor().fill("Draft before editing")
                await menu("preview-team-message-46"); await popup().getByRole("button", { name: "Edit message", exact: true }).click()
                await editor().fill("Unsent edit of removed message")
                await page.evaluate(async () => {
                    await fetch("/api/workspaces/local-preview/communications/native/messages?conversationId=preview-team&messageId=preview-team-message-46", { method: "DELETE" })
                    window.dispatchEvent(new CustomEvent("preview:realtime", { detail: { kind: "postgres_changes", table: "workspace_native_messages", payload: { eventType: "DELETE", old: { id: "preview-team-message-46" } } } }))
                })
                await surface().getByRole("button", { name: "Cancel editing", exact: true }).waitFor({ state: "detached" })
                assert.equal(await editor().textContent(), "Draft before editing")
            })
            await check("editing makes dimmed message controls inert and dims reactions", async () => {
                await open(); await menu("preview-team-message-46"); await popup().getByRole("button", { name: "Edit message", exact: true }).click()
                const target = row("preview-team-message-45")
                assert.equal(await target.getAttribute("inert"), "")
                const reactions = target.locator("xpath=following-sibling::*[1]")
                await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-message-interaction="preview-team-message-45"]').nextElementSibling).opacity === "0.3")
                assert.equal(await reactions.evaluate(node => getComputedStyle(node).opacity), "0.3")
                assert.equal(await row("preview-team-message-46").getAttribute("inert"), "")
            })
            await check("many reactions wrap within the message pane", async () => {
                await open()
                await page.evaluate(() => {
                    for (let i = 0; i < 28; i++) window.dispatchEvent(new CustomEvent("preview:realtime", { detail: { kind: "postgres_changes", table: "workspace_native_reactions", payload: { eventType: "INSERT", new: { id: `reaction-${i}`, conversation_id: "preview-team", message_id: "preview-team-message-47", reactor_user_id: `person-${i}`, emoji: "🎉", updated_at: new Date().toISOString() } } } }))
                })
                const reactions = row("preview-team-message-47").locator("xpath=following-sibling::*[1]")
                await reactions.locator("span").last().waitFor()
                const metrics = await reactions.evaluate(node => ({ width: node.clientWidth, scroll: node.scrollWidth, height: node.clientHeight, firstHeight: node.firstElementChild.getBoundingClientRect().height }))
                assert(metrics.scroll <= metrics.width + 1 && metrics.height > metrics.firstHeight * 1.5, JSON.stringify(metrics))
            })
            await check("clearing a direct chat ends its edit and restores the preserved draft", async () => {
                await open(); await back(); await choose("Alex Morgan")
                await editor().fill("Direct chat draft")
                await menu("preview-direct-0-message-16"); await popup().getByRole("button", { name: "Edit message", exact: true }).click()
                await editor().fill("Edit being cleared")
                page.once("dialog", dialog => dialog.dismiss())
                await surface().getByRole("button", { name: "Clear", exact: true }).click()
                assert.equal(await editor().textContent(), "Edit being cleared")
                assert.equal(await surface().getByRole("button", { name: "Cancel editing", exact: true }).count(), 1)
                page.once("dialog", dialog => dialog.accept())
                await surface().getByRole("button", { name: "Clear", exact: true }).click()
                await surface().getByRole("button", { name: "Cancel editing", exact: true }).waitFor({ state: "detached" })
                assert.equal(await editor().textContent(), "Direct chat draft")
                await surface().locator("[data-conversation-empty]").waitFor()
            })
            await check("many sticker reactions reserve height instead of covering the next message", async () => {
                await open()
                await page.evaluate(async () => {
                    const result = await (await fetch("/api/workspaces/local-preview/communications/native/messages?conversationId=preview-team&messageId=preview-team-message-46")).json()
                    const message = result.message
                    window.dispatchEvent(new CustomEvent("preview:realtime", { detail: { kind: "postgres_changes", table: "workspace_native_messages", payload: { eventType: "UPDATE", new: { id: message.id, conversation_id: message.conversationId, sender_user_id: message.senderUserId, sender_workspace_role: "owner", body: "", created_at: message.createdAt, edited_at: new Date().toISOString(), attachment: { kind: "sticker", storagePath: "preview-sticker", fileName: "test.webp", mimeType: "image/webp", size: 100, width: 512, height: 512 } } } } }))
                    for (let i = 0; i < 50; i++) window.dispatchEvent(new CustomEvent("preview:realtime", { detail: { kind: "postgres_changes", table: "workspace_native_reactions", payload: { eventType: "INSERT", new: { id: `reaction-${i}`, conversation_id: "preview-team", message_id: message.id, reactor_user_id: `person-${i}`, emoji: "🎉", updated_at: new Date().toISOString() } } } }))
                })
                await row("preview-team-message-46").locator("[title='Team member reacted']").last().waitFor()
                const metrics = await row("preview-team-message-46").evaluate(node => {
                    const bubble = node.querySelector("[data-message-bubble]").getBoundingClientRect()
                    const chips = Array.from(node.querySelectorAll("[title='Team member reacted']")).map(n => n.getBoundingClientRect())
                    return { left: bubble.left, right: bubble.right, top: bubble.top, bottom: bubble.bottom, minChipLeft: Math.min(...chips.map(r => r.left)), maxChipRight: Math.max(...chips.map(r => r.right)), minChipTop: Math.min(...chips.map(r => r.top)), maxChipBottom: Math.max(...chips.map(r => r.bottom)) }
                })
                assert(metrics.minChipLeft >= metrics.left - 1 && metrics.maxChipRight <= metrics.right + 1 && metrics.minChipTop >= metrics.top && metrics.maxChipBottom <= metrics.bottom, JSON.stringify(metrics))
            })
            await check("client reply spotlight includes reactions and blocks dimmed controls", async () => {
                await open("client")
                await page.evaluate(() => window.dispatchEvent(new CustomEvent("preview:realtime", { detail: { kind: "postgres_changes", table: "communication_reactions", payload: { eventType: "INSERT", new: { id: "client-reaction", relationship_id: "preview-client-0", client_message_id: "preview-client-0-message-20", direction: "inbound", emoji: "👍", updated_at: new Date().toISOString() } } } })))
                await menu("preview-client-0-message-21"); await popup().getByRole("button", { name: "Reply", exact: true }).click()
                const other = row("preview-client-0-message-20")
                assert.equal(await other.getAttribute("inert"), "")
                await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-message-interaction="preview-client-0-message-20"]').nextElementSibling).opacity === "0.3")
                await surface().getByRole("button", { name: "Cancel reply" }).click()
                assert.equal(await other.getAttribute("inert"), null)
            })
            for (const mode of ["team", "client"]) {
                const messageId = mode === "team" ? "preview-team-message-47" : "preview-client-0-message-21"
                await check(`${mode}: a late pin failure cannot leak through A → B → A`, async () => {
                    await open(mode)
                    await page.evaluate(() => {
                        const localFetch = fetch
                        window.fetch = async (input, init) => {
                            if (!String(input).endsWith("/pins") || init?.method !== "POST") return localFetch(input, init)
                            await new Promise(resolve => { window.releasePin = resolve })
                            return new Response(JSON.stringify({ error: "Earlier chat pin failed" }), { status: 400, headers: { "Content-Type": "application/json" } })
                        }
                    })
                    await menu(messageId); await popup().getByRole("button", { name: "Pin message", exact: true }).click()
                    await page.waitForFunction(() => Boolean(window.releasePin))
                    await back(); await choose(mode === "team" ? "Alex Morgan" : "Harbour Coffee"); await back(); await choose(mode === "team" ? "Project team" : "Northstar Studio")
                    await page.evaluate(() => window.releasePin()); await page.waitForTimeout(120)
                    assert.equal(await page.getByText("Earlier chat pin failed", { exact: true }).count(), 0)
                })
                await check(`${mode}: blocked recent-emoji storage does not break reaction`, async () => {
                    await open(mode)
                    await page.evaluate(() => { const set = Storage.prototype.setItem; Storage.prototype.setItem = function(key, value) { if (key.includes("recent-reaction")) throw new DOMException("Storage denied", "SecurityError"); return set.call(this, key, value) } })
                    await menu(messageId); await popup().getByRole("button", { name: "React to message", exact: true }).click()
                    await popup().getByRole("button", { name: "Use device emoji picker" }).click()
                    await page.getByRole("textbox", { name: "Emoji reaction" }).fill("🎯")
                    await popup().getByRole("button", { name: "React", exact: true }).click()
                    await popup().waitFor({ state: "detached" })
                    await row(messageId).locator("xpath=following-sibling::*[1]").getByText("🎯", { exact: true }).waitFor()
                })
            }
            assert.deepEqual(external, [])
            await context.close()
        } finally { await browser.close() }
    }
} finally {
    server.kill("SIGTERM")
    await writeFile("browser-results/comms-final-actions.json", JSON.stringify({ observedAt: new Date().toISOString(), results, limits: "Synthetic UI callback and local I/O evidence only; not physical devices or real delivery/synchronization." }, null, 2))
}
if (results.some(result => !result.passed)) process.exitCode = 1
