// Actual chat controls with synthetic OS safe-area CSS values. This is not a
// physical cutout, browser-chrome, keyboard or provider-delivery test.
import { spawn } from "node:child_process"
import { mkdir, writeFile } from "node:fs/promises"
import assert from "node:assert/strict"
import { chromium, webkit } from "playwright"

const baseline = process.argv.includes("--baseline")
const engines = process.argv.slice(2).filter(value => value !== "--baseline")
if (engines.some(engine => !["chromium", "webkit"].includes(engine))) throw Error("Use chromium and/or webkit")
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
    for (const engine of engines.length ? engines : ["chromium", "webkit"]) {
        const browser = await ({ chromium, webkit })[engine].launch()
        try {
            for (const layout of [
                { name: "portrait", width: 390, height: 844, left: 0, right: 0, top: 47, bottom: 34 },
                { name: "left-cutout", width: 844, height: 390, left: 59, right: 0, top: 0, bottom: 21 },
                { name: "right-cutout", width: 844, height: 390, left: 0, right: 59, top: 0, bottom: 21 },
                { name: "both-rounded-edges", width: 667, height: 375, left: 44, right: 44, top: 0, bottom: 21 },
                { name: "plain-mobile", width: 390, height: 844, left: 0, right: 0, top: 0, bottom: 0 },
                { name: "desktop", width: 1280, height: 900, left: 0, right: 0, top: 0, bottom: 0 },
            ]) {
                for (const mode of ["team", "client"]) {
                    const context = await browser.newContext({ viewport: { width: layout.width, height: layout.height }, hasTouch: true, isMobile: layout.name !== "desktop" })
                    const errors = [], external = []
                    await context.route("**/*", async route => {
                        const url = new URL(route.request().url())
                        if (url.origin !== origin && !["blob:", "data:"].includes(url.protocol)) { external.push(url.origin); return route.abort() }
                        if (url.pathname !== "/preview.css") return route.continue()
                        const response = await route.fetch()
                        const body = (await response.text()).replace(/env\(safe-area-inset-(left|right|top|bottom)\)/g, (_, side) => `${layout[side]}px`)
                        return route.fulfill({ response, body })
                    })
                    const page = await context.newPage()
                    page.on("pageerror", error => errors.push(error.message))
                    try {
                        await page.goto(origin)
                        if (mode === "client") await page.getByRole("tab", { name: "Clients", exact: true }).click()
                        await page.getByText(mode === "team" ? "Project team" : "Northstar Studio", { exact: true }).click()
                        if (layout.name !== "desktop") await page.waitForFunction(() => document.querySelector("[data-mobile-conversation-surface]:not([hidden])")?.dataset.phase === "open")
                        const chat = page.locator("[data-native-chat-viewport]:visible")
                        await chat.locator('[data-message-pane][data-positioned="true"]').waitFor({ state: "visible" })
                        const detail = await chat.evaluate((chat, layout) => {
                            const rect = element => { const r = element.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width } }
                            const pane = chat.querySelector("[data-message-pane]")
                            const header = chat.querySelector("header")
                            const footer = chat.querySelector("footer")
                            const pinned = header.nextElementSibling.matches("button") ? header.nextElementSibling : null
                            const padding = element => ({ left: parseFloat(getComputedStyle(element).paddingLeft), right: parseFloat(getComputedStyle(element).paddingRight) })
                            const controls = [...header.querySelectorAll("button"), footer.querySelector('button[aria-label="Send message"]'), footer.querySelector('button[aria-label="Attach image or file"]')].filter(Boolean).filter(el => el.getBoundingClientRect().width > 0).map(rect)
                            return { chat: rect(chat), header: rect(header), footer: rect(footer), pane: padding(pane), headerPadding: padding(header), footerPadding: padding(footer), pinned: pinned ? padding(pinned) : null, controls, layout }
                        }, layout)
                        if (layout.name !== "desktop") {
                            assert.equal(detail.header.top, 0)
                            assert(Math.abs(detail.footer.bottom - layout.height) < 1)
                            assert(detail.controls.every(r => r.left >= layout.left && r.right <= layout.width - layout.right), `Control enters cutout: ${JSON.stringify(detail)}`)
                            for (const padding of [detail.pane, detail.headerPadding, detail.footerPadding, detail.pinned].filter(Boolean)) assert(padding.left >= layout.left && padding.right >= layout.right, `Content enters cutout: ${JSON.stringify(detail)}`)
                        }
                        if (layout.name === "plain-mobile") {
                            assert.deepEqual(detail.headerPadding, { left: 12, right: 12 })
                            assert.deepEqual(detail.footerPadding, { left: 12, right: 12 })
                            assert.deepEqual(detail.pane, { left: 12, right: 12 })
                        }
                        if (layout.name === "desktop") {
                            assert.deepEqual(detail.headerPadding, { left: 16, right: 16 })
                            assert.deepEqual(detail.footerPadding, { left: 16, right: 16 })
                            assert.deepEqual(detail.pane, { left: 24, right: 24 })
                        }
                        const scrollable = await chat.locator("[data-message-pane]").evaluate(pane => {
                            pane.dispatchEvent(new WheelEvent("wheel", { deltaY: -100 }))
                            pane.scrollTop = 0; pane.dispatchEvent(new Event("scroll"))
                            return pane.scrollHeight - pane.clientHeight > 96
                        })
                        if (scrollable) {
                            const jump = chat.getByRole("button", { name: "Jump to latest message", exact: true })
                            await jump.waitFor({ state: "visible" })
                            const jumpBounds = await jump.boundingBox()
                            assert(jumpBounds.x >= layout.left && jumpBounds.x + jumpBounds.width <= layout.width - layout.right, `Jump control enters cutout: ${JSON.stringify(jumpBounds)}`)
                            await jump.click()
                            await jump.waitFor({ state: "hidden" })
                        }
                        assert.deepEqual(errors, []); assert.deepEqual(external, [])
                        results.push({ engine, mode, name: layout.name, passed: true, detail })
                        console.log(`${engine} ${mode} ${layout.name}: passed`)
                    } catch (error) {
                        results.push({ engine, mode, name: layout.name, passed: false, error: String(error) })
                        console.log(`${engine} ${mode} ${layout.name}: ${error}`)
                        if (!baseline) throw error
                    } finally { await context.close() }
                }
            }
        } finally { await browser.close() }
    }
} finally {
    server.kill("SIGTERM")
    await writeFile(`browser-results/comms-safe-area${baseline ? "-baseline" : ""}.json`, JSON.stringify({ observedAt: new Date().toISOString(), results, limits: "Actual components with substituted safe-area CSS environment values. No physical iOS/Android cutout or keyboard claim." }, null, 2))
}
