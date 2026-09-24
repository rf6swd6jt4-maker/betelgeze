// Actual local Team/Client UI with controlled viewport samples, never real data.
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
    const timer = setTimeout(() => reject(Error(output)), 90_000)
    const consume = chunk => {
        output = (output + chunk).slice(-12_000)
        const match = output.match(/http:\/\/localhost:(\d+)\//)
        if (match) { clearTimeout(timer); resolve(`http://127.0.0.1:${match[1]}`) }
    }
    server.stdout.on("data", consume); server.stderr.on("data", consume)
    server.once("exit", code => { clearTimeout(timer); reject(Error(`Preview exited ${code}: ${output}`)) })
})
const results = []
await mkdir("browser-results", { recursive: true })
try {
    for (const engine of engines.length ? engines : ["chromium", "webkit"]) {
        const browser = await ({ chromium, webkit })[engine].launch()
        try {
            const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
            const page = await context.newPage(), errors = [], external = []
            page.on("pageerror", error => errors.push(error.message))
            page.on("dialog", dialog => dialog.accept())
            await context.route("**/*", route => {
                const url = new URL(route.request().url())
                if (url.origin === origin || ["blob:", "data:"].includes(url.protocol)) return route.continue()
                external.push(url.origin); return route.abort()
            })
            async function open(mode) {
                await page.goto(origin)
                if (mode === "client") await page.getByRole("tab", { name: "Clients", exact: true }).click()
                await page.getByText(mode === "team" ? "New project" : "New client", { exact: true }).click()
                await page.waitForFunction(() => document.querySelector("[data-mobile-conversation-surface]:not([hidden])")?.dataset.phase === "open")
                await page.evaluate(() => {
                    const viewport = window.visualViewport
                    window.edgeHeight = viewport.height
                    Object.defineProperty(viewport, "height", { configurable: true, get: () => window.edgeHeight })
                    window.edgeEditor = document.querySelector("[data-mobile-conversation-surface]:not([hidden]) [data-chat-composer]")
                })
            }
            const surface = () => page.locator("[data-mobile-conversation-surface]:not([hidden])")
            const editor = () => surface().locator("[data-chat-composer]")
            const check = async (name, callback) => {
                try { const detail = await callback(); results.push({ engine, name, passed: true, detail }); console.log(`${engine}: ${name}`) }
                catch (error) { results.push({ engine, name, passed: false, error: String(error) }); console.log(`${engine}: FAIL ${name}: ${error}`); if (!baseline) throw error }
            }
            async function cycle(height, markerText = "Start the conversation") {
                return page.evaluate(async ({ height, markerText }) => {
                    const surface = document.querySelector("[data-mobile-conversation-surface]:not([hidden])")
                    const layer = surface.querySelector("[data-chat-motion-layer]")
                    const marker = [...surface.querySelectorAll("p,div,span")].find(p => p.textContent === markerText)
                    const snapshot = () => {
                        const p = marker.getBoundingClientRect(), h = surface.querySelector("header").getBoundingClientRect(), c = surface.querySelector("[data-composer-slot]").getBoundingClientRect()
                        return { top: p.top, bottom: p.bottom, headerBottom: h.bottom, composerTop: c.top, composerBottom: c.bottom, scroll: surface.querySelector("[data-message-pane]").scrollTop, focused: window.edgeEditor === surface.querySelector("[data-chat-composer]") }
                    }
                    const samples = [snapshot()]
                    window.edgeHeight = height; window.visualViewport.dispatchEvent(new Event("resize"))
                    const animations = layer.getAnimations({ subtree: true }).filter(a => a.effect.target === layer || a.effect.target?.matches("[data-composer-slot]"))
                    for (const animation of animations) { animation.pause(); await animation.ready }
                    const frame = () => new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)))
                    for (const progress of [0, .2, .5, .8, .999]) {
                        for (const animation of animations) animation.currentTime = Number(animation.effect.getTiming().duration) * progress
                        await frame(); samples.push(snapshot())
                    }
                    for (const animation of animations) animation.finish()
                    await frame(); await frame(); samples.push(snapshot())
                    return samples
                }, { height, markerText })
            }
            for (const mode of ["team", "client"]) {
                await open(mode)
                await check(`${mode}: empty prompt stays visible without endpoint jumps`, async () => {
                    const traces = []
                    for (const height of [524, 844, 524, 844]) {
                        const samples = await cycle(height)
                        const before = samples.at(-2), after = samples.at(-1)
                        traces.push({ height, samples })
                        assert(Math.abs(after.top - before.top) < 2, `Prompt jumps when motion retires: ${JSON.stringify(traces)}`)
                        assert(samples.every(s => s.top >= s.headerBottom && s.bottom <= s.composerTop && s.focused), `Prompt clips during keyboard movement: ${JSON.stringify(traces)}`)
                        assert(Math.abs(after.composerBottom - height) < 2)
                    }
                    return traces
                })
                await check(`${mode}: compact empty chat does not invent scroll or a jump-to-latest control`, async () => {
                    await cycle(300)
                    const state = await surface().evaluate(surface => {
                        const pane = surface.querySelector("[data-message-pane]")
                        const text = [...surface.querySelectorAll("p")].find(p => p.textContent === "Start the conversation")
                        const r = text.getBoundingClientRect(), p = pane.getBoundingClientRect(), c = surface.querySelector("[data-composer-slot]").getBoundingClientRect()
                        return { overflow: pane.scrollHeight - pane.clientHeight, scroll: pane.scrollTop, top: r.top, bottom: r.bottom, paneTop: p.top, composerTop: c.top }
                    })
                    assert(state.overflow <= 1 && state.scroll <= 1, `Empty prompt creates scrollable history: ${JSON.stringify(state)}`)
                    assert(state.top >= state.paneTop && state.bottom <= state.composerTop, JSON.stringify(state))
                    await cycle(844)
                    return state
                })
                await check(`${mode}: empty-chat motion retargets and reverses without moving its prompt`, async () => {
                    await page.evaluate(async () => {
                        const surface = document.querySelector("[data-mobile-conversation-surface]:not([hidden])")
                        const slot = surface.querySelector("[data-composer-slot]"), prompt = surface.querySelector("[data-conversation-empty]")
                        const top = prompt.getBoundingClientRect().top
                        let painted = slot.getBoundingClientRect().bottom
                        const frame = () => new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)))
                        for (const height of [524, 484, 844, 524]) {
                            window.edgeHeight = height; window.visualViewport.dispatchEvent(new Event("resize"))
                            const animation = slot.getAnimations()[0]
                            if (!animation) throw Error("Empty composer lost its motion")
                            animation.pause(); await animation.ready; animation.currentTime = 0
                            await frame()
                            if (Math.abs(slot.getBoundingClientRect().bottom - painted) > 1) throw Error("Empty composer snapped on retarget")
                            animation.currentTime = Number(animation.effect.getTiming().duration) * .3
                            await frame()
                            painted = slot.getBoundingClientRect().bottom
                            if (Math.abs(prompt.getBoundingClientRect().top - top) > 1) throw Error("Empty prompt moved with the composer")
                        }
                        slot.getAnimations()[0].finish(); await frame(); await frame()
                        if (slot.getAnimations().length || slot.style.willChange) throw Error("Empty composer retained motion after completion")
                    })
                    await cycle(844)
                })
                await check(`${mode}: first message replaces prompt and retains composer identity`, async () => {
                    await editor().fill("First synthetic message")
                    await surface().getByRole("button", { name: "Send message", exact: true }).click()
                    await surface().getByText("First synthetic message", { exact: true }).waitFor()
                    assert.equal(await surface().getByText("Start the conversation", { exact: true }).count(), 0)
                    assert.equal(await editor().evaluate(node => node === window.edgeEditor), true)
                    await page.waitForFunction(() => [...document.querySelectorAll("[data-message-interaction]")].every(row => !row.getAnimations().some(animation => animation.playState === "running")))
                    const samples = await cycle(524, "First synthetic message")
                    assert(Math.abs(samples.at(-1).bottom - samples.at(-2).bottom) < 2, `Short chat jumps at completion: ${JSON.stringify(samples)}`)
                    await cycle(844, "First synthetic message")
                })
                await check(`${mode}: removing the final row restores a stable empty prompt`, async () => {
                    const id = await surface().locator("[data-message-interaction]").getAttribute("data-message-interaction")
                    if (mode === "team") {
                        await surface().locator("[data-message-bubble]").click({ button: "right" })
                        await page.locator("[data-anchored-popup]").getByRole("button", { name: "Delete message", exact: true }).click()
                    } else {
                        // Local delivery into the real UI delete callback; client
                        // provider deletion is intentionally not a chat action.
                        await page.evaluate(id => window.dispatchEvent(new CustomEvent("preview:realtime", { detail: { kind: "postgres_changes", table: "client_messages", payload: { eventType: "DELETE", old: { id, relationship_id: "preview-client-3" } } } })), id)
                    }
                    await surface().getByText("Start the conversation", { exact: true }).waitFor()
                    assert.equal(await surface().locator("[data-message-interaction]").count(), 0)
                    const samples = await cycle(524)
                    assert(Math.abs(samples.at(-1).top - samples.at(-2).top) < 2, `Restored empty prompt jumps: ${JSON.stringify(samples)}`)
                    assert.equal(await editor().evaluate(node => node === window.edgeEditor), true)
                    await cycle(844)
                })
                await check(`${mode}: empty draft growth and accessory removal keep the prompt reachable`, async () => {
                    await cycle(524)
                    await editor().fill("one\ntwo\nthree\nfour\nfive\nsix\nseven\neight")
                    await surface().getByRole("button", { name: "Open sticker tray", exact: true }).click()
                    await surface().getByRole("button", { name: "Close sticker tray", exact: true }).click()
                    await editor().fill("")
                    await page.waitForFunction(() => {
                        const pane = document.querySelector("[data-mobile-conversation-surface]:not([hidden]) [data-message-pane]")
                        return pane && pane.scrollHeight <= pane.clientHeight + 1
                    })
                    const samples = await cycle(844)
                    assert(samples.every(s => s.top >= s.headerBottom && s.bottom <= s.composerTop && s.focused))
                })
            }
            assert.deepEqual(errors, []); assert.deepEqual(external, [])
            await context.close()
        } finally { await browser.close() }
    }
} finally {
    server.kill("SIGTERM")
    await writeFile(`browser-results/fullscreen-comms-edges${baseline ? "-baseline" : ""}.json`, JSON.stringify({ observedAt: new Date().toISOString(), results, limits: "Actual components with synthetic visualViewport and local data. Not physical keyboard timing or production syncing." }, null, 2))
}
