// Browser interactions against real AssetLibrary/AssetGallery components and synthetic HTTP attachments.
import { spawn } from "node:child_process"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import assert from "node:assert/strict"
import { chromium, webkit } from "playwright"
import { ZipReader, Uint8ArrayReader, TextWriter } from "@zip.js/zip.js"

const measureSelection = process.argv.includes("--measure-selection")
const engines = process.argv.slice(2).filter(argument => argument !== "--measure-selection")
if (engines.some(engine => !["chromium", "webkit"].includes(engine))) throw Error("Use chromium and/or webkit, optionally --measure-selection")
const baselineRef = measureSelection ? process.env.ASSET_LIBRARY_BASELINE_REF || "HEAD" : undefined
const server = spawn(process.execPath, ["scripts/serve-asset-library-fixture.mjs"], { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ...(baselineRef ? { ASSET_LIBRARY_BASELINE_REF: baselineRef } : {}) } })
const results = []
const timingObservations = []
const imageId = "00000000-0000-4000-8000-000000000001"
const documentId = "00000000-0000-4000-8000-000000000002"
const output = "browser-results/asset-library"
await mkdir(output, { recursive: true })

async function measureLocalSelection(browser, engine, mobile, origin) {
    // Matched production-React fixture observations cannot establish production-app speed.
    // Complete means selection has painted and the visible image has decoded.
    const fixtures = []
    try {
        for (const variant of ["baseline", "candidate"]) {
            const context = await browser.newContext({ viewport: { width: mobile ? 390 : 1280, height: 844 }, isMobile: mobile, hasTouch: mobile })
            await context.addInitScript(() => Object.defineProperty(window, "showSaveFilePicker", { value: undefined, configurable: true }))
            const page = await context.newPage()
            const fixture = { variant, context, page, thumbnailRequests: 0, apiRequests: 0, imageReplacements: 0, samples: { enter: [], toggle: [], exit: [] } }
            fixtures.push(fixture)
            page.on("request", request => { const path = new URL(request.url()).pathname; if (path === "/thumbnail.svg") fixture.thumbnailRequests++; if (path.startsWith("/api/")) fixture.apiRequests++ })
            await page.goto(`${origin}${variant === "baseline" ? "baseline" : ""}`)
            await page.getByRole("button", { name: "Select", exact: true }).waitFor()
            await page.evaluate(() => window.fixture.setMany(24))
            await page.locator('img[src="/thumbnail.svg"]').evaluate(async node => { await node.decode(); window.fixturePreviousImage = node })
            fixture.initialThumbnailRequests = fixture.thumbnailRequests
        }
        async function sample(page, locator, boundary) {
            await locator.evaluate((node, boundary) => {
                window.fixtureMeasurement = new Promise((resolve, reject) => {
                    const timer = setTimeout(() => reject(Error("Selection measurement did not finish")), 5000)
                    node.addEventListener("click", () => {
                        const start = performance.now()
                        requestAnimationFrame(async () => {
                            try {
                                await document.querySelector('img[src="/thumbnail.svg"]').decode()
                                requestAnimationFrame(() => {
                                    clearTimeout(timer)
                                    const inputs = [...document.querySelectorAll('input[type="checkbox"]')]
                                    const complete = boundary === "enter" ? inputs.length === 24 : boundary === "toggle" ? inputs[0]?.checked : inputs.length === 0
                                    const image = document.querySelector('img[src="/thumbnail.svg"]')
                                    const replaced = image !== window.fixturePreviousImage
                                    window.fixturePreviousImage = image
                                    resolve({ ms: performance.now() - start, complete, replaced })
                                })
                            } catch (error) { clearTimeout(timer); reject(error) }
                        })
                    }, { once: true, capture: true })
                })
            }, boundary)
            if (mobile) await locator.tap(); else await locator.click()
            const result = await page.evaluate(() => window.fixtureMeasurement)
            assert.equal(result.complete, true, `${boundary} reached visible state`)
            return result
        }
        // Alternate the leading variant each round; 3 warmups and 30 observed samples per action.
        for (let index = 0; index < 33; index++) {
            for (const fixture of index % 2 ? [...fixtures].reverse() : fixtures) {
                const { page } = fixture
                await page.bringToFront()
                const enter = await sample(page, page.getByRole("button", { name: "Select", exact: true }), "enter")
                const toggle = await sample(page, page.getByRole("checkbox", { name: "Select Campaign image", exact: true }), "toggle")
                const exit = await sample(page, page.getByRole("button", { name: "Cancel", exact: true }), "exit")
                fixture.imageReplacements += [enter, toggle, exit].filter(result => result.replaced).length
                if (index >= 3) { fixture.samples.enter.push(enter.ms); fixture.samples.toggle.push(toggle.ms); fixture.samples.exit.push(exit.ms) }
            }
        }
        for (const fixture of fixtures) {
            assert.equal(fixture.apiRequests, 0)
            if (fixture.variant === "candidate") { assert.equal(fixture.thumbnailRequests, 1); assert.equal(fixture.imageReplacements, 0) }
            const summarize = values => { const sorted = [...values].sort((left, right) => left - right); return { count: values.length, medianMs: (sorted[14] + sorted[15]) / 2, p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1], minMs: sorted[0], maxMs: sorted.at(-1) } }
            timingObservations.push({ engine, mobile, variant: fixture.variant, baselineRef, rows: 24, warmup: 3, samples: fixture.samples, summary: Object.fromEntries(Object.entries(fixture.samples).map(([action, values]) => [action, summarize(values)])), apiRequests: fixture.apiRequests, initialThumbnailRequests: fixture.initialThumbnailRequests, totalThumbnailRequests: fixture.thumbnailRequests, imageReplacements: fixture.imageReplacements })
            console.log(`OBSERVE ${engine}-${mobile ? "mobile" : "desktop"} ${fixture.variant}: ${JSON.stringify(timingObservations.at(-1).summary)}; thumbnails=${fixture.thumbnailRequests}; imageReplacements=${fixture.imageReplacements}`)
        }
    } finally { for (const fixture of fixtures) await fixture.context.close() }
}

async function verifySavePicker(browser, engine, mobile, origin) {
    const label = `${engine}-${mobile ? "mobile" : "desktop"}-picker`
    const context = await browser.newContext({ viewport: { width: mobile ? 390 : 1280, height: 844 }, isMobile: mobile, hasTouch: mobile })
    const requests = [], errors = [], helperChunks = []
    await context.addInitScript(() => {
        const state = { mode: "hold-close", calls: 0, writes: [], closeCalls: 0, closed: false, aborts: 0, pickerActivation: [], options: [] }
        window.fixtureSave = state
        const handle = () => ({ name: "chosen-assets.zip", async createWritable() {
            state.writes = []; state.closed = false
            if (state.mode === "create-failure") throw Error("Fixture destination unavailable")
            return new WritableStream({
                write(chunk) {
                    if (state.mode === "write-failure") throw Error("Fixture disk write failed")
                    state.writes.push(Array.from(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength)))
                    if (state.mode === "hold-write") return new Promise(resolve => { state.releaseWrite = resolve })
                },
                close() {
                    state.closeCalls++
                    if (state.mode === "close-failure") throw Error("Fixture file close failed")
                    if (state.mode === "hold-close") return new Promise(resolve => { state.releaseClose = () => { state.closed = true; resolve() } })
                    state.closed = true
                },
                abort() { state.aborts++ },
            })
        } })
        Object.defineProperty(window, "showSaveFilePicker", { configurable: true, value(options) {
            state.calls++; state.options.push(options); state.pickerActivation.push(navigator.userActivation?.isActive ?? null)
            if (state.mode === "cancel-picker") return Promise.reject(new DOMException("User cancelled", "AbortError"))
            if (state.mode === "hold-picker") return new Promise(resolve => { state.releasePicker = () => resolve(handle()) })
            return Promise.resolve(handle())
        } })
    })
    context.on("request", request => {
        const path = new URL(request.url()).pathname
        if (path.startsWith("/api/")) requests.push(path)
        if (path.startsWith("/asset-fixture-")) helperChunks.push(path)
    })
    await context.route("**/*", route => new URL(route.request().url()).origin === new URL(origin).origin ? route.continue() : route.abort())
    const page = await context.newPage()
    page.on("pageerror", error => errors.push(error.message))
    let nativeDownloads = 0
    page.on("download", () => nativeDownloads++)
    const activate = locator => mobile ? locator.tap() : locator.click()
    const save = () => page.getByRole("button", { name: "Save ZIP as…", exact: true })
    const status = text => page.getByRole("status").filter({ hasText: text })
    const selected = () => page.getByRole("checkbox", { checked: true })
    const setMode = mode => page.evaluate(mode => { window.fixtureSave.mode = mode; window.fixtureSave.closed = false }, mode)
    const waitIdle = () => page.waitForFunction(() => [...document.querySelectorAll("button")].some(button => button.textContent === "Save ZIP as…" && !button.disabled))
    try {
        await page.goto(origin)
        await activate(page.getByRole("button", { name: "Select", exact: true }))
        assert.equal(await save().count(), 0, "a save picker is offered only for an archive")
        await activate(page.getByRole("button", { name: "Select all visible", exact: true }))
        assert.deepEqual(helperChunks, [], "the streaming helper is not loaded during entry or selection")
        assert.deepEqual(requests, [], "selection does not fetch originals")
        await activate(save())
        await page.waitForFunction(() => window.fixtureSave.closeCalls === 1)
        await status("Saving ZIP…").waitFor()
        assert.equal(await status("ZIP saved.").count(), 0, "stream end is not success until the destination closes")
        assert.equal(await selected().count(), 2, "selection remains until saving is confirmed")
        assert.equal(await page.evaluate(() => window.fixtureSave.pickerActivation[0]), true, "the picker is called during the initiating user gesture")
        assert.equal(helperChunks.length, 1, "the optional helper loads only once on demand")
        // New choices made while a requested archive saves must survive its completion.
        await page.evaluate(() => window.fixture.setMany(3))
        await activate(page.getByRole("checkbox", { name: "Select Additional asset 3", exact: true }))
        assert.equal(await selected().count(), 3)
        await page.evaluate(() => window.fixtureSave.releaseClose())
        await status("ZIP saved.").waitFor()
        assert.equal(await selected().count(), 1)
        assert.equal(await page.getByRole("checkbox", { name: "Select Additional asset 3", exact: true }).isChecked(), true)
        assert.equal(await page.getByRole("checkbox", { name: "Select Campaign image", exact: true }).isChecked(), false)
        assert.equal(await page.getByRole("checkbox", { name: "Select Procedure document", exact: true }).isChecked(), false)
        await page.evaluate(() => window.fixture.reset())
        // Fixture updates schedule a React render; wait for the removed card before inspecting selection.
        await page.getByRole("checkbox", { name: "Select Additional asset 3", exact: true }).waitFor({ state: "detached" })
        assert.equal(await selected().count(), 0)
        await page.screenshot({ path: `${output}/${label}-saved.png` })
        assert.equal(nativeDownloads, 0, "Save as streams to its chosen destination without starting a second browser download")
        const saved = Buffer.from(await page.evaluate(() => window.fixtureSave.writes.flat()))
        const archive = new ZipReader(new Uint8ArrayReader(saved))
        assert.deepEqual((await archive.getEntries()).map(entry => entry.filename), ["Campaign image.png", "Procedure document.pdf"])
        await archive.close()

        await activate(page.getByRole("button", { name: "Select all visible", exact: true }))
        await setMode("cancel-picker")
        const requestsBeforeCancel = requests.length
        await activate(save())
        await waitIdle()
        assert.equal(requests.length, requestsBeforeCancel, "cancelling a picker never fetches an archive")
        assert.equal(await selected().count(), 2)

        // Access can change while a platform picker is open; its late answer cannot revive a stale request.
        await setMode("hold-picker")
        const requestsBeforeRevocation = requests.length
        await activate(save())
        await status("Choose where to save the ZIP…").waitFor()
        await page.evaluate(id => window.fixture.revoke(id), documentId)
        await page.waitForFunction(() => document.querySelector('input[aria-label="Select Procedure document"]')?.disabled === true)
        await page.evaluate(() => window.fixtureSave.releasePicker())
        await page.getByRole("alert").filter({ hasText: "Some files are no longer available" }).waitFor()
        await page.getByRole("link", { name: "Download 1 asset", exact: true }).waitFor()
        assert.equal(requests.length, requestsBeforeRevocation, "a revoked pending picker does not start an archive")
        await page.evaluate(() => window.fixture.reset())
        assert.equal(await page.getByRole("checkbox", { name: "Select Procedure document", exact: true }).isChecked(), false)
        await activate(page.getByRole("button", { name: "Select all visible", exact: true }))

        await setMode("close-failure")
        await activate(save())
        await page.getByRole("alert").waitFor()
        await waitIdle()
        assert.equal(await selected().count(), 2, "a failed destination close retains the requested selection")
        assert.equal(await status("ZIP saved.").count(), 0)

        // Authorization/route failures preserve intent and never report a saved file.
        await setMode("success")
        await page.route("**/api/workspaces/fixture/assets/download?*", route => route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ error: "Fixture access denied" }) }))
        await activate(save())
        await page.getByRole("alert").waitFor()
        await waitIdle()
        assert.equal(await selected().count(), 2)
        assert.equal(await status("ZIP saved.").count(), 0)
        assert.equal(await page.evaluate(() => window.fixtureSave.closed), false)
        await page.unroute("**/api/workspaces/fixture/assets/download?*")

        // A picker resolving after cancellation must not start a transfer.
        await setMode("hold-picker")
        const beforeLatePicker = requests.length
        await activate(save())
        await status("Choose where to save the ZIP…").waitFor()
        await activate(page.getByRole("button", { name: "Cancel save", exact: true }))
        await page.evaluate(() => window.fixtureSave.releasePicker())
        await waitIdle()
        assert.equal(requests.length, beforeLatePicker)
        assert.equal(await selected().count(), 2)

        // Keep the response source open so this is an actual mid-transfer cancellation.
        // Once a source has drained, destination close can legitimately win a cancel race.
        await page.goto(`${origin}?stream=hold`)
        await setMode("success")
        await activate(page.getByRole("button", { name: "Select", exact: true }))
        await activate(page.getByRole("button", { name: "Select all visible", exact: true }))
        await activate(save())
        await page.waitForFunction(() => window.fixtureSave.writes.length > 0)
        await activate(page.getByRole("button", { name: "Cancel save", exact: true }))
        await waitIdle()
        assert.equal(await selected().count(), 2)
        assert.equal(await page.evaluate(() => window.fixtureSave.closed), false)
        assert.ok(await page.evaluate(() => window.fixtureSave.aborts > 0))
        assert.equal(await status("ZIP saved.").count(), 0)
        assert.deepEqual(errors, [])
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
        await page.screenshot({ path: `${output}/${label}.png` })
        results.push({ engine, mobile, savePicker: true, passed: true, apiRequests: requests.length, helperChunks: helperChunks.length, nativeDownloads })
        console.log(`PASS ${label}: gesture, streamed bytes, confirmed close, concurrent choices, access revocation, picker cancel, transfer failure, late picker, save cancellation`)
    } catch (error) {
        results.push({ engine, mobile, savePicker: true, passed: false, error: String(error), errors, requests })
        await page.screenshot({ path: `${output}/${label}-failed.png` }).catch(() => {})
        console.error(`FAIL ${label}: ${error.stack ?? error}`)
    } finally { await context.close() }
}

try {
    const origin = await new Promise((resolve, reject) => {
        let log = ""
        const timer = setTimeout(() => reject(Error(`Fixture startup: ${log}`)), 60_000)
        const receive = chunk => {
            log = (log + chunk).slice(-12000)
            const match = log.match(/http:\/\/127\.0\.0\.1:\d+\//)
            if (match) { clearTimeout(timer); resolve(match[0]) }
        }
        server.stdout.on("data", receive)
        server.stderr.on("data", receive)
        server.once("error", error => { clearTimeout(timer); reject(error) })
        server.once("exit", code => { clearTimeout(timer); reject(Error(`Fixture exit ${code}: ${log}`)) })
    })
    for (const engine of engines.length ? engines : ["chromium", "webkit"]) {
        const browser = await ({ chromium, webkit })[engine].launch()
        try {
            for (const mobile of [false, true]) {
                const label = `${engine}-${mobile ? "mobile" : "desktop"}`
                const context = await browser.newContext({ viewport: { width: mobile ? 390 : 1280, height: 844 }, isMobile: mobile, hasTouch: mobile, acceptDownloads: true })
                const errors = [], external = [], requests = []
                let attachmentDownloads = 0, thumbnailRequests = 0
                await context.addInitScript(() => Object.defineProperty(window, "showSaveFilePicker", { value: undefined, configurable: true }))
                context.on("request", request => { const path = new URL(request.url()).pathname; if (path.startsWith("/api/")) requests.push(request.url()); if (path === "/thumbnail.svg") thumbnailRequests++ })
                await context.route("**/*", route => {
                    if (new URL(route.request().url()).origin === new URL(origin).origin) return route.continue()
                    external.push(route.request().url())
                    return route.abort()
                })
                const page = await context.newPage()
                page.on("pageerror", error => errors.push(error.message))
                page.on("download", () => { attachmentDownloads++ })
                const downloadRequestCount = async () => (await (await context.request.get(`${origin}__fixture/download-requests`)).json()).length
                const initialDownloadRequests = await downloadRequestCount()
                const activate = async locator => mobile ? locator.tap() : locator.click()
                const imageLink = () => page.getByRole("link", { name: /Campaign image/ })
                const checkedImage = () => page.getByRole("checkbox", { name: "Select Campaign image", exact: true })
                const openContext = async () => { await imageLink().click({ button: "right" }); await page.getByRole("menu").waitFor() }
                const download = async (locator, expectedSuffix) => {
                    const downloaded = page.waitForEvent("download")
                    await activate(locator)
                    const file = await downloaded
                    assert.equal(await file.failure(), null)
                    assert.ok(file.url().endsWith(expectedSuffix), file.url())
                    const bytes = await readFile(await file.path())
                    return { file, bytes }
                }
                try {
                    await page.goto(origin)
                    await imageLink().waitFor()
                    assert.equal(await page.getByRole("checkbox").count(), 0)
                    assert.equal(await page.getByRole("link", { name: "New asset", exact: true }).count(), 1)
                    await activate(imageLink())
                    await page.getByRole("heading", { name: "Asset destination" }).waitFor()
                    assert.ok(page.url().endsWith(`/fixture/assets/${imageId}`), "ordinary card activation keeps detail navigation")
                    await page.goto(origin)
                    await imageLink().waitFor()

                    await page.locator('img[src="/thumbnail.svg"]').evaluate(async node => { await node.decode(); window.fixtureImage = node })
                    const thumbnailsBeforeSelection = thumbnailRequests
                    const assertStablePreview = async () => {
                        assert.equal(await page.locator('img[src="/thumbnail.svg"]').evaluate(node => node === window.fixtureImage), true, "selection preserves the mounted decoded preview")
                        assert.equal(thumbnailRequests, thumbnailsBeforeSelection, "selection does not repeat thumbnail requests")
                    }

                    // Context actions are local, dismissible, keyboard reachable, and clamped to the viewport.
                    await openContext()
                    const menuRect = await page.getByRole("menu").boundingBox()
                    assert.ok(menuRect && menuRect.x >= 0 && menuRect.y >= 0 && menuRect.x + menuRect.width <= (mobile ? 390 : 1280))
                    assert.equal(await page.getByRole("menuitem", { name: "Select", exact: true }).count(), 1)
                    assert.equal(await page.getByRole("menuitem", { name: "Download", exact: true }).count(), 1)
                    await activate(page.locator("#outside"))
                    assert.equal(await page.getByRole("menu").count(), 0)
                    await imageLink().focus()
                    await page.keyboard.press("Shift+F10")
                    await page.getByRole("menu").waitFor()
                    await page.keyboard.press("Escape")
                    assert.equal(await page.getByRole("menu").count(), 0)
                    assert.equal(await imageLink().evaluate(node => node === document.activeElement), true)
                    assert.deepEqual(requests, [], "opening and dismissing context menus makes no API requests")

                    // Right-click Download initiates a browser attachment download without navigating the gallery.
                    await openContext()
                    const single = await download(page.getByRole("menuitem", { name: "Download", exact: true }), `/api/workspaces/fixture/assets/${imageId}/download`)
                    assert.equal(single.file.suggestedFilename(), "Campaign image.png")
                    assert.equal(single.bytes.toString(), "Original library asset bytes\n")
                    assert.equal(await page.getByRole("menu").count(), 0)
                    assert.equal(page.url(), origin)
                    const downloadsBeforeSelection = requests.length
                    const transfersBeforeSelection = await downloadRequestCount()

                    // Header selection exposes native top-right checkboxes and replaces New asset.
                    await activate(page.getByRole("button", { name: "Select", exact: true }))
                    assert.equal(await page.getByRole("link", { name: "New asset", exact: true }).count(), 0)
                    assert.equal(await page.getByRole("button", { name: "Download 0 assets", exact: true }).isEnabled(), false)
                    assert.equal(await page.getByRole("checkbox").count(), 3)
                    await assertStablePreview()
                    assert.equal(await page.getByRole("button", { name: "Save ZIP as…", exact: true }).count(), 0, "unsupported browsers keep the native download path")
                    await activate(page.getByRole("button", { name: "Select all visible", exact: true }))
                    assert.equal(await checkedImage().isChecked(), true)
                    assert.equal(await page.getByRole("checkbox", { name: "Select Procedure document", exact: true }).isChecked(), true)
                    assert.equal(await page.getByRole("checkbox", { name: "Select Asset without file", exact: true }).isChecked(), false)
                    await activate(page.getByRole("button", { name: "Clear selection", exact: true }))
                    assert.equal(await checkedImage().isChecked(), false)
                    await checkedImage().focus()
                    await page.keyboard.press("Space")
                    assert.equal(await checkedImage().isChecked(), true)
                    await page.keyboard.press("Space")
                    assert.equal(await checkedImage().isChecked(), false)
                    assert.equal(await page.getByRole("checkbox", { name: "Select Asset without file", exact: true }).isEnabled(), false)
                    const corner = await checkedImage().evaluate(node => {
                        const box = node.getBoundingClientRect(), card = node.closest("label").parentElement.getBoundingClientRect()
                        return { top: box.top - card.top, right: card.right - box.right }
                    })
                    assert.ok(corner.top >= 0 && corner.top <= 24 && corner.right >= 0 && corner.right <= 24, JSON.stringify(corner))
                    await activate(checkedImage())
                    await page.getByRole("link", { name: "Download 1 asset", exact: true }).waitFor()
                    assert.equal(await checkedImage().isChecked(), true)
                    assert.ok((await page.getByRole("link", { name: "Download 1 asset", exact: true }).getAttribute("href")).endsWith(`/assets/${imageId}/download`))
                    await activate(page.getByRole("button", { name: "Select Procedure document", exact: true }))
                    await page.getByRole("link", { name: "Download 2 assets", exact: true }).waitFor()
                    assert.equal(await page.getByRole("checkbox", { name: "Select Procedure document", exact: true }).isChecked(), true)
                    assert.equal(page.url(), origin, "selection controls never navigate")
                    assert.equal(requests.length, downloadsBeforeSelection, "selection uses already loaded data without requests")
                    assert.equal(await downloadRequestCount(), transfersBeforeSelection, "selection does not trigger hidden original downloads")
                    await page.screenshot({ path: `${output}/${label}-selection.png` })
                    const bulk = await download(page.getByRole("link", { name: "Download 2 assets", exact: true }), `/api/workspaces/fixture/assets/download?ids=${imageId},${documentId}`)
                    assert.equal(bulk.file.suggestedFilename(), "fixture-assets.zip")
                    const archive = new ZipReader(new Uint8ArrayReader(bulk.bytes))
                    const entries = await archive.getEntries()
                    assert.deepEqual(entries.map(entry => entry.filename), ["Campaign image.png", "Procedure document.pdf"])
                    assert.equal(await entries[0].getData(new TextWriter()), "Original library asset bytes\n")
                    await archive.close()
                    assert.equal(page.url(), origin)
                    const requestsAfterDownloads = requests.length
                    const transfersAfterDownloads = await downloadRequestCount()
                    assert.equal(await page.getByRole("checkbox").count(), 0, "native handoff clears selection")
                    await page.getByRole("status").filter({ hasText: "Download requested." }).waitFor()
                    await page.screenshot({ path: `${output}/${label}-requested.png` })
                    assert.equal(await page.getByText("ZIP saved.", { exact: true }).count(), 0, "browser handoff is not reported as saved")
                    await assertStablePreview()
                    await activate(page.getByRole("button", { name: "Select again", exact: true }))
                    assert.equal(await checkedImage().isChecked(), true)
                    assert.equal(await page.getByRole("checkbox", { name: "Select Procedure document", exact: true }).isChecked(), true)
                    assert.equal(requests.length, requestsAfterDownloads, "selection recovery does not retry the transfer")
                    await activate(page.getByRole("button", { name: "Cancel", exact: true }))
                    assert.equal(await page.getByRole("checkbox").count(), 0)
                    assert.equal(await page.getByRole("link", { name: "New asset", exact: true }).count(), 1)
                    await assertStablePreview()

                    // Context Select enters selection mode and checks only its asset; cancel clears the selection.
                    await openContext()
                    await activate(page.getByRole("menuitem", { name: "Select", exact: true }))
                    assert.equal(await checkedImage().isChecked(), true)
                    assert.equal(await page.getByRole("checkbox", { name: "Select Procedure document", exact: true }).isChecked(), false)
                    await page.getByRole("button", { name: "Select Campaign image", exact: true }).click({ button: "right" })
                    await activate(page.getByRole("menuitem", { name: "Deselect", exact: true }))
                    assert.equal(await checkedImage().isChecked(), false)
                    assert.equal(await page.getByRole("button", { name: "Download 0 assets", exact: true }).isEnabled(), false)
                    await activate(page.getByRole("button", { name: "Cancel", exact: true }))
                    await page.getByRole("link", { name: /Asset without file/ }).click({ button: "right" })
                    assert.equal(await page.getByRole("menuitem", { name: "Download", exact: true }).isEnabled(), false)
                    assert.equal(await page.getByRole("menuitem", { name: "Select", exact: true }).isEnabled(), false)
                    await page.keyboard.press("Escape")
                    assert.equal(await page.getByRole("menu").count(), 0)
                    await activate(page.getByRole("button", { name: "Select", exact: true }))
                    assert.equal(await checkedImage().isChecked(), false)
                    assert.equal(await page.getByRole("button", { name: "Download 0 assets", exact: true }).isEnabled(), false)
                    assert.equal(requests.length, requestsAfterDownloads)
                    assert.equal(attachmentDownloads, 2)
                    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, "the controls fit the viewport")

                    // Known oversized archives are blocked locally; one large original remains downloadable.
                    await page.evaluate(() => window.fixture.setLarge())
                    await activate(checkedImage())
                    await page.getByRole("link", { name: "Download 1 asset", exact: true }).waitFor()
                    await activate(page.getByRole("checkbox", { name: "Select Procedure document", exact: true }))
                    assert.equal(await page.getByRole("button", { name: "Download 2 assets", exact: true }).isEnabled(), false)
                    await activate(page.getByRole("button", { name: "Cancel", exact: true }))
                    assert.equal(requests.length, requestsAfterDownloads)

                    await page.evaluate(() => window.fixture.reset())

                    // Missing metadata is explicit; revocation reconciles the local selection immediately.
                    await activate(page.getByRole("button", { name: "Select", exact: true }))
                    await page.evaluate(() => window.fixture.setUnknown())
                    await activate(page.getByRole("button", { name: "Select all visible", exact: true }))
                    await page.getByRole("link", { name: "Download 2 assets", exact: true }).waitFor()
                    assert.match(await page.getByRole("group", { name: "Asset selection", exact: true }).innerText(), /unknown/i)
                    await page.evaluate(id => window.fixture.revoke(id), documentId)
                    await page.getByRole("link", { name: "Download 1 asset", exact: true }).waitFor()
                    assert.equal(await page.getByRole("checkbox", { name: "Select Procedure document", exact: true }).isChecked(), false)
                    assert.equal(await page.getByRole("checkbox", { name: "Select Procedure document", exact: true }).isEnabled(), false)
                    await page.evaluate(() => window.fixture.reset())
                    assert.equal(await page.getByRole("checkbox", { name: "Select Procedure document", exact: true }).isChecked(), false, "reappearing access does not silently restore stale selection")
                    await activate(page.getByRole("button", { name: "Cancel", exact: true }))
                    assert.equal(requests.length, requestsAfterDownloads)

                    // A larger future loaded page cannot accidentally exceed the server's archive count limit.
                    await page.evaluate(() => window.fixture.setMany())
                    await activate(page.getByRole("button", { name: "Select", exact: true }))
                    await activate(page.getByRole("button", { name: "Select all visible", exact: true }))
                    assert.equal(await page.getByRole("link", { name: /Download (25|26) assets/ }).count(), 0)
                    assert.match(await page.locator("main").innerText(), /24/)
                    await activate(page.getByRole("button", { name: "Cancel", exact: true }))
                    await page.evaluate(() => window.fixture.reset())
                    assert.equal(requests.length, requestsAfterDownloads)

                    // Two clicks in the same event turn request only one native transfer.
                    await activate(page.getByRole("button", { name: "Select", exact: true }))
                    await activate(checkedImage())
                    const duplicateDownload = page.waitForEvent("download")
                    await page.getByRole("link", { name: "Download 1 asset", exact: true }).evaluate(node => { node.click(); node.click() })
                    assert.equal(await (await duplicateDownload).failure(), null)
                    await page.waitForTimeout(100)
                    assert.equal(await downloadRequestCount(), transfersAfterDownloads + 1)
                    assert.equal(attachmentDownloads, 3)
                    assert.equal(await page.getByRole("checkbox").count(), 0)

                    // Revoked previous downloads cannot silently become partial retry selections.
                    await page.evaluate(id => window.fixture.remove(id), imageId)
                    await activate(page.getByRole("button", { name: "Select again", exact: true }))
                    await page.getByRole("alert").filter({ hasText: "Some files are no longer available" }).waitFor()
                    assert.equal(await page.getByRole("link", { name: /Download [1-9]/ }).count(), 0)
                    assert.equal(await downloadRequestCount(), transfersAfterDownloads + 1)
                    await page.evaluate(() => window.fixture.reset())
                    if (await page.getByRole("button", { name: "Cancel", exact: true }).count()) await activate(page.getByRole("button", { name: "Cancel", exact: true }))

                    // Downloading a context asset preserves other selected assets and leaves their action usable.
                    await activate(page.getByRole("button", { name: "Select", exact: true }))
                    await activate(page.getByRole("button", { name: "Select all visible", exact: true }))
                    await page.getByRole("button", { name: "Select Campaign image", exact: true }).click({ button: "right" })
                    await download(page.getByRole("menuitem", { name: "Download", exact: true }), `/api/workspaces/fixture/assets/${imageId}/download`)
                    assert.equal(await checkedImage().isChecked(), false)
                    assert.equal(await page.getByRole("checkbox", { name: "Select Procedure document", exact: true }).isChecked(), true)
                    await download(page.getByRole("link", { name: "Download 1 asset", exact: true }), `/api/workspaces/fixture/assets/${documentId}/download`)
                    assert.equal(await page.getByRole("checkbox").count(), 0)
                    assert.equal(await downloadRequestCount(), transfersAfterDownloads + 3)
                    assert.equal(attachmentDownloads, 5)
                    assert.equal(await downloadRequestCount() - initialDownloadRequests, 5)

                    // Native retained tabs release their menu and never revive it when shown again.
                    await openContext()
                    await page.evaluate(() => window.fixture.setActive(false))
                    await page.getByRole("menu").waitFor({ state: "detached" })
                    await page.evaluate(() => window.fixture.setActive(true))
                    await imageLink().waitFor()
                    assert.equal(await page.getByRole("menu").count(), 0)
                    await imageLink().focus()
                    await page.keyboard.press("Shift+F10")
                    await page.getByRole("menuitem", { name: "Select", exact: true }).press("Enter")
                    await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "Select Campaign image" && document.activeElement?.tagName === "INPUT")
                    assert.equal(await checkedImage().isChecked(), true)

                    // Parent-shell portals must close for iframe tab departure and must not revive on return.
                    await page.goto(`${origin}host`)
                    const frame = page.frameLocator("#owner-frame")
                    await frame.getByRole("link", { name: /Campaign image/ }).click({ button: "right" })
                    await page.getByRole("menu").waitFor()
                    assert.equal(await page.getByRole("menu").evaluate(node => node.ownerDocument === document), true)
                    await page.evaluate(() => {
                        const view = document.querySelector("#owner-frame").contentWindow
                        view.document.body.dataset.workspaceTabActive = "false"
                        view.dispatchEvent(new Event("betelgeze:workspace-tab-visibility"))
                    })
                    await page.getByRole("menu").waitFor({ state: "detached" })
                    await page.evaluate(() => {
                        const view = document.querySelector("#owner-frame").contentWindow
                        view.document.body.dataset.workspaceTabActive = "true"
                        view.dispatchEvent(new Event("betelgeze:workspace-tab-visibility"))
                    })
                    assert.equal(await page.getByRole("menu").count(), 0)
                    await frame.getByRole("link", { name: /Campaign image/ }).click({ button: "right" })
                    await page.getByRole("menu").waitFor()
                    await page.evaluate(() => document.querySelector("#owner-frame").remove())
                    await page.getByRole("menu").waitFor({ state: "detached" })
                    assert.deepEqual(errors, [])
                    assert.deepEqual(external, [])
                    results.push({ engine, mobile, passed: true, attachmentDownloads, serverDownloadRequests: await downloadRequestCount() - initialDownloadRequests, observedApiRequests: requests.length, thumbnailRequests, preservedPreviewAcrossSelection: true })
                    console.log(`PASS ${label}: native downloads, local selection/recovery, stable previews, bounds, access changes, duplicate clicks, iframe dismissal`)
                } catch (error) {
                    results.push({ engine, mobile, passed: false, error: String(error), errors, requests })
                    await page.screenshot({ path: `${output}/${label}-failed.png` }).catch(() => {})
                    console.error(`FAIL ${label}: ${error.stack ?? error}`)
                } finally { await context.close() }
            }
            for (const mobile of [false, true]) await verifySavePicker(browser, engine, mobile, origin)
            if (measureSelection) for (const mobile of [false, true]) await measureLocalSelection(browser, engine, mobile, origin)
        } finally { await browser.close() }
    }
} finally {
    server.kill("SIGTERM")
    await writeFile(`${output}/results.json`, JSON.stringify({ results, timingObservations, limits: "Real components with synthetic local HTTP attachment responses. This verifies browser behavior and payload handling, not canonical route authorization, authenticated production data, production speed, or physical Android/iPhone behavior." }, null, 2))
}
assert.equal(results.length, (engines.length || 2) * 4)
assert.ok(results.every(result => result.passed), "Asset Library browser regression failed")
