import { spawn } from "node:child_process"
import { mkdir, writeFile } from "node:fs/promises"
import assert from "node:assert/strict"
import { chromium, webkit } from "playwright"

const engines = process.argv.slice(2)
if (engines.some(engine => !["chromium", "webkit"].includes(engine))) throw Error("Use chromium and/or webkit")
const server = spawn(process.execPath, ["scripts/serve-native-loading-fixture.mjs"], { stdio: ["ignore", "pipe", "pipe"] })
const output = process.env.NATIVE_LOADING_OUTPUT ?? "browser-results/native-loading"
const observations = []
await mkdir(output, { recursive: true })
try {
    const origin = await new Promise((resolve, reject) => {
        let log = ""
        const timer = setTimeout(() => reject(Error(`Fixture startup timeout: ${log}`)), 90_000)
        const consume = chunk => { log = (log + chunk).slice(-12000); const match = log.match(/http:\/\/127\.0\.0\.1:\d+\//); if (match) { clearTimeout(timer); resolve(match[0]) } }
        server.stdout.on("data", consume); server.stderr.on("data", consume)
        server.once("error", error => { clearTimeout(timer); reject(error) })
        server.once("exit", code => { clearTimeout(timer); reject(Error(`Fixture exit ${code}: ${log}`)) })
    })
    for (const engine of engines.length ? engines : ["chromium", "webkit"]) {
        const browser = await ({ chromium, webkit })[engine].launch({ headless: true })
        try {
            for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 900 }]) {
                const context = await browser.newContext({ viewport, reducedMotion: "reduce" })
                try {
                    const page = await context.newPage(), errors = [], external = []
                    page.on("pageerror", error => errors.push(error.message))
                    await context.route("**/*", route => { if (new URL(route.request().url()).origin === new URL(origin).origin) return route.continue(); external.push(route.request().url()); return route.abort() })
                    const fixture = expression => page.evaluate(expression)
                    const pending = () => page.waitForFunction(() => window.nativeLoadingFixture?.pending() === 1)
                    // Explicit arguments cross the browser boundary only through evaluate.
                    const respond = status => page.evaluate(code => window.nativeLoadingFixture.settle(code), status)
                    const refreshing = page.getByRole("status", { name: "Refreshing tab", includeHidden: true })
                    await page.goto(origin)
                    await pending()
                    assert.equal(await page.locator('[aria-label="Loading Work Items"]').count(), 1)
                    assert.equal(await refreshing.count(), 0, "cold reads use only the panel skeleton")
                    assert.equal(await page.locator("[data-workspace-shared-banner]").count(), 1)
                    await page.locator("[data-workspace-shared-banner]").evaluate(node => { window.originalLoadingBanner = node })
                    await respond(200)
                    await page.locator("[data-fixture-content]").waitFor()
                    assert.equal(await fixture(() => document.querySelector("[data-workspace-shared-banner]") === window.originalLoadingBanner), true)
                    await page.locator("[data-fixture-counter]").click()
                    assert.equal(await page.locator('[aria-label="Loading activity trends"]').count(), 1)
                    await page.locator("[data-fixture-section]").click()
                    await page.locator("[data-fixture-resolved]").waitFor()
                    await fixture(() => { window.nativeLoadingFixture.refresh(); window.nativeLoadingFixture.refresh() })
                    await pending()
                    assert.equal(await fixture(() => window.nativeLoadingFixture.requests.length), 2, "refreshes share one in-flight read")
                    assert.equal(await refreshing.count(), 1)
                    assert.equal(await refreshing.isVisible(), viewport.width < 768)
                    assert.equal(await page.locator("[data-fixture-content]").isVisible(), true)
                    await page.locator("[data-fixture-counter]").click()
                    await fixture(() => window.nativeLoadingFixture.active(false))
                    await page.locator("[data-native-workspace-tab]").waitFor({ state: "hidden" })
                    assert.equal(await refreshing.count(), 0, "inactive tabs expose no refresh feedback")
                    await fixture(() => window.nativeLoadingFixture.active(true))
                    await page.locator("[data-fixture-content]").waitFor()
                    await respond(500)
                    await page.getByRole("alert").waitFor()
                    assert.equal(await refreshing.count(), 0)
                    assert.equal(await page.locator("[data-fixture-counter]").textContent(), "Local edits: 2")
                    assert.equal(await page.locator("[data-fixture-resolved]").count(), 1, "refresh failure retains visible section")
                    await page.getByRole("button", { name: "Retry", exact: true }).click()
                    await pending()
                    await respond(200)
                    await page.getByRole("alert").waitFor({ state: "detached" })
                    assert.equal(await page.locator("[data-fixture-counter]").textContent(), "Local edits: 2", "retry does not remount usable content")
                    await fixture(() => window.nativeLoadingFixture.navigate("/fixture/assets"))
                    await pending()
                    assert.equal(await page.locator('[aria-label="Loading Assets"]').count(), 1)
                    assert.equal(await refreshing.count(), 0)
                    await respond(500)
                    await page.getByRole("alert").waitFor()
                    assert.equal(await page.locator("[data-fixture-content]").count(), 0)
                    assert.equal(await page.locator('[aria-label="Loading Assets"]').count(), 0, "a failed empty read exposes recovery instead of perpetual loading")
                    await page.getByRole("button", { name: "Retry", exact: true }).click()
                    await pending()
                    assert.equal(await refreshing.count(), 0, "empty retry continues the opening skeleton")
                    await respond(200)
                    await page.locator("[data-fixture-content]").waitFor()
                    await fixture(() => window.nativeLoadingFixture.refresh())
                    await pending()
                    await respond(403)
                    await page.getByRole("alert").waitFor()
                    assert.equal(await page.locator("[data-fixture-content]").count(), 0, "access loss clears previously visible private content")
                    assert.equal(await refreshing.count(), 0)
                    const requestCount = await fixture(() => window.nativeLoadingFixture.requests.length)
                    assert.equal(requestCount, 6)
                    assert.equal(await fixture(() => document.querySelector("[data-workspace-shared-banner]") === window.originalLoadingBanner), true)
                    assert.deepEqual(errors, [])
                    assert.deepEqual(external, [])
                    observations.push({ engine, viewport, requestCount, passed: ["cold opening", "deferred section", "retained refresh", "refresh failure", "retry", "empty failure", "access loss", "stable banner", "inactive tab", "no external I/O"] })
                    await page.screenshot({ path: `${output}/${engine}-${viewport.width}-recovery.png`, animations: "disabled" })
                    console.log(`${engine} ${viewport.width}: native loading lifecycle passed; ${requestCount} bounded reads`)
                } finally { await context.close() }
            }
        } finally { await browser.close() }
    }
} finally {
    server.kill("SIGTERM")
    await writeFile(`${output}.json`, JSON.stringify({ observations, limits: "Actual native tab, cache, refresh and chrome owners with synthetic responses/content. No authenticated app, production latency, or physical device evidence." }, null, 2))
}
