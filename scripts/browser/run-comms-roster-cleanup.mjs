// Actual roster, member-profile and mobile surface with synthetic local I/O.
import { spawn } from "node:child_process"
import { mkdir, writeFile } from "node:fs/promises"
import assert from "node:assert/strict"
import { chromium, webkit } from "playwright"
import { createCanvas, loadImage } from "@napi-rs/canvas"

const output = process.env.ROSTER_CLEANUP_OUTPUT ?? "browser-results/comms-roster-cleanup"
await mkdir(output, { recursive: true })

async function settle(page) {
    await page.evaluate(async () => {
        await document.fonts.ready
        await Promise.allSettled(document.getAnimations().filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity).map(animation => animation.finished))
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    })
}

async function capture(page, key) {
    const state = await page.evaluate(() => {
        const active = document.activeElement
        const style = active ? getComputedStyle(active) : null
        const rect = active?.getBoundingClientRect()
        const focusRing = active?.matches(":focus-visible") && style && (style.outlineStyle !== "none" || style.boxShadow !== "none")
            ? { x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom } : null
        const layers = []
        for (const node of document.querySelectorAll("*")) {
            if (!node.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue
            for (const pseudo of [null, "::before", "::after", ...(node.matches("dialog:modal") ? ["::backdrop"] : [])]) {
                const style = getComputedStyle(node, pseudo)
                if (pseudo && pseudo !== "::backdrop" && ["none", "normal"].includes(style.content)) continue
                const filter = style.filter
                const backdrop = style.backdropFilter || style.getPropertyValue("-webkit-backdrop-filter")
                const effect = !["none", ""].includes(filter) || !["none", ""].includes(backdrop)
                if (effect || ["fixed", "sticky"].includes(style.position)) layers.push({ tag: node.tagName, id: node.id, label: node.getAttribute("aria-label"), pseudo, filter, backdrop, effect, background: style.background, opacity: style.opacity })
            }
        }
        return { focusRing, layers, active: { tag: active?.tagName, label: active?.getAttribute("aria-label") }, modals: document.querySelectorAll("dialog:modal").length }
    })
    const png = await page.screenshot({ path: `${output}/${key}.png`, animations: "allow" })
    await writeFile(`${output}/${key}.json`, JSON.stringify(state, null, 2))
    return { png, state }
}

async function compareViewport(before, after, key) {
    const first = await loadImage(before.png), second = await loadImage(after.png)
    assert.equal(first.width, second.width); assert.equal(first.height, second.height)
    const canvas = createCanvas(first.width, first.height), ctx = canvas.getContext("2d")
    ctx.drawImage(first, 0, 0); const a = ctx.getImageData(0, 0, first.width, first.height)
    ctx.drawImage(second, 0, 0); const b = ctx.getImageData(0, 0, first.width, first.height)
    const diff = ctx.createImageData(first.width, first.height)
    const rings = [before.state.focusRing, after.state.focusRing].filter(Boolean)
    let changedPixels = 0, focusRingPixels = 0, unexplainedPixels = 0
    for (let index = 0; index < a.data.length; index += 4) {
        const delta = Math.max(...[0, 1, 2].map(channel => Math.abs(a.data[index + channel] - b.data[index + channel])))
        if (delta <= 2) continue
        changedPixels++
        const x = (index / 4 % first.width) / 3, y = Math.floor(index / 4 / first.width) / 3
        // Keyboard dismissal intentionally restores a focus ring. Only its thin
        // boundary is allowed; the entire header and its interior stay checked.
        const ring = rings.some(rect => x >= rect.x - 4 && x <= rect.right + 4 && y >= rect.y - 4 && y <= rect.bottom + 4
            && (x <= rect.x + 4 || x >= rect.right - 4 || y <= rect.y + 4 || y >= rect.bottom - 4))
        if (ring) focusRingPixels++; else unexplainedPixels++
        diff.data[index] = ring ? 0 : 255; diff.data[index + 1] = ring ? 255 : 0; diff.data[index + 3] = 255
    }
    ctx.putImageData(diff, 0, 0)
    await writeFile(`${output}/${key}-diff.png`, canvas.toBuffer("image/png"))
    assert.equal(unexplainedPixels, 0, `Full viewport has ${unexplainedPixels} changed pixels outside intentional focus-ring boundaries`)
    return { width: first.width, height: first.height, changedPixels, focusRingPixels, unexplainedPixels }
}

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
            const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 3, reducedMotion: "no-preference" })
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
                const dialog = page.getByRole("dialog", { name: mode === "team" ? "Project team" : "Client conversation", exact: true })
                const trigger = header.getByRole("button", { name: mode === "team" ? "View Project team members" : "Client conversation participants", exact: true })
                for (const dismiss of ["close", "escape", "backdrop", "member profile"]) {
                    await check(`${mode}: ${dismiss} retires overlays and restores full viewport`, async () => {
                        const key = `${engine}-${mode}-${dismiss.replaceAll(" ", "-")}`
                        await settle(page)
                        const before = await capture(page, `${key}-before`)
                        const overflow = await page.evaluate(() => document.body.style.overflow)
                        await trigger.tap(); await dialog.waitFor()
                        if (dismiss === "member profile") {
                            await dialog.getByRole("button", { name: "Open Alex Morgan profile", exact: true }).tap()
                            const profile = page.getByRole("dialog", { name: "Alex Morgan", exact: true })
                            await profile.waitFor()
                            assert.equal(await profile.evaluate(node => getComputedStyle(node).backdropFilter), "blur(8px)")
                            await profile.getByRole("button", { name: "Close profile", exact: true }).tap()
                            await profile.waitFor({ state: "detached" })
                        }
                        if (dismiss === "escape") await page.keyboard.press("Escape")
                        else if (dismiss === "backdrop") await dialog.tap({ position: { x: 3, y: 3 } })
                        else await dialog.getByRole("button", { name: mode === "team" ? "Close team members" : "Close participants", exact: true }).tap()
                        await dialog.waitFor({ state: "detached" })
                        assert.equal(await page.getByRole("dialog").count(), 0)
                        assert.equal(await page.locator("[data-anchored-popup]").count(), 0)
                        assert.equal(await page.evaluate(() => document.body.style.overflow), overflow)
                        await capture(page, `${key}-raw-after`)
                        await settle(page)
                        const after = await capture(page, `${key}-after`)
                        assert.equal(after.state.modals, 0)
                        assert.deepEqual(after.state.layers.filter(layer => layer.effect), [], "Visible filter or pseudo-element backdrop remains after dismissal")
                        const pixels = await compareViewport(before, after, key)
                        const filter = await header.evaluate(node => ({ filter: getComputedStyle(node).filter, backdrop: getComputedStyle(node).backdropFilter }))
                        assert.deepEqual(filter, { filter: "none", backdrop: "none" })
                        return { pixels, remainingDialogs: 0, remainingFilterLayers: 0, restoredOverflow: true }
                    })
                }
                await check(`${mode}: nested profile owns keyboard dismissal and restores roster focus`, async () => {
                    await trigger.tap(); await dialog.waitFor()
                    const rosterSelector = mode === "team" ? '[aria-labelledby="team-roster-title"]' : '[aria-labelledby="client-participants-title"]'
                    const profileTrigger = dialog.getByRole("button", { name: "Open Alex Morgan profile", exact: true })
                    await profileTrigger.tap()
                    const profile = page.getByRole("dialog", { name: "Alex Morgan", exact: true })
                    await profile.waitFor()
                    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("aria-label")), "Close profile")
                    // This used to focus and activate the covered roster's Close
                    // button, leaving the profile's blur behind on its own.
                    await page.keyboard.press("Tab")
                    assert.equal(await page.evaluate(selector => Boolean(document.activeElement?.closest(selector)), rosterSelector), false)
                    await page.keyboard.press("Enter")
                    assert.equal(await page.locator(rosterSelector).count(), 1, "Tab/Enter must not dismiss the covered roster")
                    assert.equal(await profile.evaluate(node => node.matches(":modal")), true)
                    await page.keyboard.press("Escape")
                    await profile.waitFor({ state: "detached" })
                    await dialog.waitFor()
                    assert.equal(await profileTrigger.evaluate(node => node === document.activeElement), true)
                    assert.equal(await page.locator("dialog:modal").count(), 0)
                    await page.keyboard.press("Escape")
                    await dialog.waitFor({ state: "detached" })
                    return { coveredRosterPreserved: true, restoredProfileTriggerFocus: true, remainingDialogs: 0 }
                })
                await check(`${mode}: profile touch dismissal leaves the roster usable`, async () => {
                    await trigger.tap(); await dialog.waitFor()
                    const profileTrigger = dialog.getByRole("button", { name: "Open Alex Morgan profile", exact: true })
                    for (const dismiss of ["close", "backdrop"]) {
                        await profileTrigger.tap()
                        const profile = page.getByRole("dialog", { name: "Alex Morgan", exact: true })
                        await profile.waitFor()
                        if (dismiss === "close") await profile.getByRole("button", { name: "Close profile", exact: true }).tap()
                        else await profile.tap({ position: { x: 3, y: 3 } })
                        await profile.waitFor({ state: "detached" })
                        await dialog.waitFor()
                        assert.equal(await profileTrigger.evaluate(node => node === document.activeElement), true)
                        assert.equal(await page.locator("dialog:modal").count(), 0)
                    }
                    await dialog.getByRole("button", { name: mode === "team" ? "Close team members" : "Close participants", exact: true }).tap()
                    await dialog.waitFor({ state: "detached" })
                    assert.equal(await page.getByRole("dialog").count(), 0)
                    return { touchCloseAndBackdrop: true, restoredProfileTriggerFocus: true, remainingDialogs: 0 }
                })
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
    await writeFile("browser-results/comms-roster-cleanup.json", JSON.stringify({ observedAt: new Date().toISOString(), results, limits: "Actual components and synthetic local I/O in Chromium/WebKit mobile emulation. Normal motion, real touch, scale 3, full viewport pixels (only thin intentional keyboard focus-ring boundaries allowed), and visible element/pseudo-element filters are checked; the reported device residue is not reproduced by this fixture." }, null, 2))
}
assert.equal(results.length, (selected.length || 2) * 16)
assert(results.every(result => result.passed), "Roster cleanup regression failed")
