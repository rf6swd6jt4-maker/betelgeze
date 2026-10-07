// Browser interactions against real AssetLibrary/AssetGallery components and synthetic HTTP attachments.
import { spawn } from "node:child_process"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import assert from "node:assert/strict"
import { chromium, webkit } from "playwright"
import { ZipReader, Uint8ArrayReader, TextWriter } from "@zip.js/zip.js"

const engines = process.argv.slice(2)
if (engines.some(engine => !["chromium", "webkit"].includes(engine))) throw Error("Use chromium and/or webkit")
const server = spawn(process.execPath, ["scripts/serve-asset-library-fixture.mjs"], { stdio: ["ignore", "pipe", "pipe"] })
const results = []
const imageId = "00000000-0000-4000-8000-000000000001"
const documentId = "00000000-0000-4000-8000-000000000002"
const output = "browser-results/asset-library"
await mkdir(output, { recursive: true })

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
                let attachmentDownloads = 0
                context.on("request", request => { if (new URL(request.url()).pathname.startsWith("/api/")) requests.push(request.url()) })
                await context.route("**/*", route => {
                    if (new URL(route.request().url()).origin === new URL(origin).origin) return route.continue()
                    external.push(route.request().url())
                    return route.abort()
                })
                const page = await context.newPage()
                page.on("pageerror", error => errors.push(error.message))
                page.on("download", () => { attachmentDownloads++ })
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

                    // Header selection exposes native top-right checkboxes and replaces New asset.
                    await activate(page.getByRole("button", { name: "Select", exact: true }))
                    assert.equal(await page.getByRole("link", { name: "New asset", exact: true }).count(), 0)
                    assert.equal(await page.getByRole("button", { name: "Download 0 assets", exact: true }).isEnabled(), false)
                    assert.equal(await page.getByRole("checkbox").count(), 3)
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
                    await activate(page.getByRole("button", { name: "Cancel", exact: true }))
                    assert.equal(await page.getByRole("checkbox").count(), 0)
                    assert.equal(await page.getByRole("link", { name: "New asset", exact: true }).count(), 1)

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
                    results.push({ engine, mobile, passed: true, attachmentDownloads, apiRequests: requests.length })
                    console.log(`PASS ${label}: navigation, context actions, checkboxes, counts, attachment bytes, iframe dismissal`)
                } catch (error) {
                    results.push({ engine, mobile, passed: false, error: String(error), errors, requests })
                    await page.screenshot({ path: `${output}/${label}-failed.png` }).catch(() => {})
                    console.error(`FAIL ${label}: ${error.stack ?? error}`)
                } finally { await context.close() }
            }
        } finally { await browser.close() }
    }
} finally {
    server.kill("SIGTERM")
    await writeFile(`${output}/results.json`, JSON.stringify({ results, limits: "Real components with synthetic local HTTP attachment responses. This verifies browser behavior and payload handling, not canonical route authorization, authenticated production data, production speed, or physical Android/iPhone behavior." }, null, 2))
}
assert.equal(results.length, (engines.length || 2) * 2)
assert.ok(results.every(result => result.passed), "Asset Library browser regression failed")
