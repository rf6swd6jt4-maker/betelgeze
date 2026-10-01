// Actual roster, member-profile and mobile surface with synthetic local I/O.
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
await mkdir("browser-results", { recursive: true })
try {
    for (const engine of selected.length ? selected : ["chromium", "webkit"]) {
        const browser = await ({ chromium, webkit })[engine].launch()
        try {
            const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 3 })
            const errors = [], external = []
            await context.route("**/*", route => {
                const url = new URL(route.request().url())
                if (url.origin === origin || ["data:", "blob:"].includes(url.protocol)) return route.continue()
                external.push(url.origin); return route.abort()
            })
            const page = await context.newPage()
            page.on("pageerror", error => errors.push(error.message))
            const surface = () => page.locator("[data-mobile-conversation-surface]:not([hidden])")
            async function check(name, run) {
                try { const evidence = await run(); results.push({ engine, name, passed: true, evidence }); console.log(`${engine}: ${name}`) }
                catch (error) {
                    results.push({ engine, name, passed: false, error: String(error) })
                    console.error(`${engine}: ${name}: ${error}`)
                    await page.screenshot({ path: `browser-results/${engine}-comms-roster-cleanup-failure.png` })
                }
            }
            for (const mode of ["team", "client"]) {
                await page.goto(origin)
                if (mode === "client") await page.getByRole("tab", { name: "Clients", exact: true }).click()
                const title = mode === "team" ? "Project team" : "Northstar Studio"
                await page.getByText(title, { exact: true }).click()
                await page.waitForFunction(() => document.querySelector("[data-mobile-conversation-surface]:not([hidden])")?.dataset.phase === "open")
                const header = surface().locator("[data-native-chat-viewport]>header")
                const titleElement = header.getByText(title, { exact: true }).filter({ visible: true }).first()
                const dialog = page.getByRole("dialog", { name: mode === "team" ? "Project team" : "Client conversation", exact: true })
                const trigger = header.getByRole("button", { name: mode === "team" ? "View Project team members" : "Client conversation participants", exact: true })
                for (const dismiss of ["close", "escape", "backdrop", "member profile"]) {
                    await check(`${mode}: ${dismiss} retires overlays and preserves header pixels`, async () => {
                        const before = await titleElement.screenshot()
                        const overflow = await page.evaluate(() => document.body.style.overflow)
                        await trigger.click(); await dialog.waitFor()
                        if (dismiss === "member profile") {
                            await dialog.getByRole("button", { name: "Open Alex Morgan profile", exact: true }).click()
                            const profile = page.getByRole("dialog", { name: "Alex Morgan", exact: true })
                            await profile.waitFor()
                            assert.equal(await profile.evaluate(node => getComputedStyle(node).backdropFilter), "blur(8px)")
                            await profile.getByRole("button", { name: "Close profile", exact: true }).click()
                            await profile.waitFor({ state: "detached" })
                        }
                        if (dismiss === "escape") await page.keyboard.press("Escape")
                        else if (dismiss === "backdrop") await dialog.click({ position: { x: 3, y: 3 } })
                        else await dialog.getByRole("button", { name: mode === "team" ? "Close team members" : "Close participants", exact: true }).click()
                        await dialog.waitFor({ state: "detached" })
                        assert.equal(await page.getByRole("dialog").count(), 0)
                        assert.equal(await page.locator("[data-anchored-popup]").count(), 0)
                        assert.equal(await page.evaluate(() => document.body.style.overflow), overflow)
                        const after = await titleElement.screenshot()
                        assert(before.equals(after), "Header title pixels changed after popup cleanup")
                        const filter = await header.evaluate(node => ({ filter: getComputedStyle(node).filter, backdrop: getComputedStyle(node).backdropFilter }))
                        assert.deepEqual(filter, { filter: "none", backdrop: "none" })
                        return { identicalTitlePixels: true, remainingDialogs: 0, restoredOverflow: true }
                    })
                }
                await check(`${mode}: hidden chrome releases backdrop filters`, async () => {
                    const layers = await page.locator("[data-workspace-topbar], [data-workspace-tabbar]").evaluateAll(nodes => nodes.map(node => {
                        const style = getComputedStyle(node)
                        return { visibility: style.visibility, opacity: style.opacity, backdrop: style.backdropFilter, webkitBackdrop: style.getPropertyValue("-webkit-backdrop-filter") }
                    }))
                    assert(layers.length === 2)
                    for (const layer of layers) {
                        assert.equal(layer.visibility, "hidden"); assert.equal(layer.opacity, "0")
                        assert.equal(layer.backdrop, "none", "Hidden chrome retains a backdrop compositor input")
                        assert(["", "none"].includes(layer.webkitBackdrop))
                    }
                    return layers
                })
                await check(`${mode}: conversation departure restores normal chrome`, async () => {
                    await header.getByRole("button", { name: mode === "team" ? "Back to team conversations" : "Back to client chats", exact: true }).click()
                    await page.waitForFunction(() => document.documentElement.dataset.mobileConversationOpen !== "true")
                    const layers = await page.locator("[data-workspace-topbar], [data-workspace-tabbar]").evaluateAll(nodes => nodes.map(node => {
                        const style = getComputedStyle(node)
                        return { visibility: style.visibility, opacity: style.opacity, backdrop: style.backdropFilter }
                    }))
                    for (const layer of layers) assert.deepEqual(layer, { visibility: "visible", opacity: "1", backdrop: "blur(8px)" })
                    return layers
                })
            }
            assert.deepEqual(errors, []); assert.deepEqual(external, [])
            await context.close()
        } finally { await browser.close() }
    }
} finally {
    server.kill("SIGTERM")
    await writeFile("browser-results/comms-roster-cleanup.json", JSON.stringify({ observedAt: new Date().toISOString(), results, limits: "Actual components and synthetic local I/O in Chromium/WebKit mobile emulation. Hidden compositor inputs and pixel restoration are checked; the reported device residue is not reproduced by this fixture." }, null, 2))
}
assert.equal(results.length, (selected.length || 2) * 12)
assert(results.every(result => result.passed), "Roster cleanup regression failed")
