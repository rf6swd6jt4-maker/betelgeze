import { spawn } from "node:child_process"
import { mkdir, writeFile } from "node:fs/promises"
import assert from "node:assert/strict"
import { chromium, webkit } from "playwright"
const engines = process.argv.slice(2)
if (engines.some(engine => !["chromium", "webkit"].includes(engine))) throw Error("Use chromium and/or webkit")
const strict = process.env.SETTINGS_POPUP_STRICT === "1"
const names = strict ? ["initial service"] : ["service editor", "service templates", "invitation", "colour editor", "branding preview", "publish review"]
const requestedScenarios = process.env.SETTINGS_POPUP_SCENARIOS?.split(",")
const server = spawn(process.execPath, ["scripts/serve-settings-popup-ownership-fixture.mjs"], { stdio: ["ignore", "pipe", "pipe"] })
const results = []
const selector = '[role="dialog"], [data-agency-branding-preview]'
await mkdir("browser-results", { recursive: true })
try {
    const origin = await new Promise((resolve, reject) => {
        let output = ""
        const timer = setTimeout(() => reject(Error(`Fixture startup timeout: ${output}`)), 90_000)
        const consume = chunk => { output = (output + chunk).slice(-12000); const match = output.match(/http:\/\/127\.0\.0\.1:\d+\//); if (match) { clearTimeout(timer); resolve(match[0]) } }
        server.stdout.on("data", consume); server.stderr.on("data", consume)
        server.once("error", error => { clearTimeout(timer); reject(error) })
        server.once("exit", code => { clearTimeout(timer); reject(Error(`Fixture exit ${code}: ${output}`)) })
    })
    for (const engine of engines.length ? engines : ["chromium", "webkit"]) {
        const browser = await ({ chromium, webkit })[engine].launch()
        try {
            for (const framed of [true, false]) for (const name of names) {
                const scenarios = strict || !framed ? ["retained-tab"] : ["retained-tab", "remove", "navigate", "reload", "hidden-remove", "cached-page"]
                if (!strict && name === "invitation") scenarios.push("invite-success")
                for (const scenario of scenarios.filter(value => !requestedScenarios || requestedScenarios.includes(value))) {
                    const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
                    const errors = [], requests = [], lookups = []
                    await context.route("**/*", route => {
                        const url = new URL(route.request().url())
                        if (scenario === "invite-success" && url.origin === new URL(origin).origin && url.pathname === "/api/workspaces/fixture/users/lookup") { lookups.push(url.href); return route.continue() }
                        if (url.origin !== new URL(origin).origin || url.pathname.startsWith("/api/")) { requests.push(url.href); return route.abort() }
                        return route.continue()
                    })
                    try {
                        const page = await context.newPage()
                        page.setDefaultTimeout(5000)
                        page.on("pageerror", error => errors.push(error.message))
                        const type = name.includes("service") ? "service" : name === "invitation" ? "invitation" : "branding"
                        await page.goto(`${origin}${framed ? "host" : ""}?type=${type}${strict ? "&initial=1" : ""}${scenario === "invite-success" ? "&invite-success=1" : ""}`)
                        const frame = framed ? await (await page.locator("iframe").elementHandle()).contentFrame() : page.mainFrame()
                        await frame.waitForFunction(() => !!window.fixture)
                        const visibleSurface = page.locator('[role="dialog"]:visible, [data-agency-branding-preview]:visible')
                        async function open(initial = false) {
                            if (name === "initial service" && initial) return
                            if (name === "service editor" || name === "initial service") await frame.getByRole("button", { name: "Edit Fixture service" }).click()
                            else if (name === "service templates") await frame.getByRole("button", { name: "New service", exact: true }).click()
                            else if (name === "invitation") await frame.getByRole("button", { name: "Add user", exact: true }).click()
                            else if (name === "colour editor") await frame.getByRole("button", { name: /Primary actions and links/ }).click()
                            else { await frame.getByRole("button", { name: "Preview", exact: true }).click(); if (name === "publish review") await page.getByRole("button", { name: "Publish", exact: true }).click() }
                            await visibleSurface.first().waitFor()
                        }
                        async function checkReleased() {
                            await page.waitForFunction(selector => ![...document.querySelectorAll(selector)].some(node => node.checkVisibility()), selector)
                            assert.equal(await page.evaluate(() => document.body.style.overflow), "", "departure releases its scroll lock")
                            await page.locator("#outside").first().click()
                            const prevented = await page.evaluate(() => { const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }); document.dispatchEvent(event); return event.defaultPrevented })
                            assert.equal(prevented, false, "departed presentation has no Escape handler")
                            await page.keyboard.press("Tab")
                            assert.equal(await page.evaluate(selector => Boolean(document.activeElement?.closest(selector)), selector), false, "departed form cannot trap focus")
                        }
                        await open(true)
                        await visibleSurface.first().waitFor()
                        if (name === "service editor" || name === "initial service") await page.getByRole("textbox", { name: "Name", exact: true }).fill("Retained service draft")
                        if (name === "invitation") await page.getByRole("textbox", { name: "Username or email" }).fill(scenario === "invite-success" ? "fixture@example.invalid" : "ab")
                        if (name === "colour editor") { await page.getByRole("button", { name: "Add colour style" }).click(); await page.getByRole("textbox", { name: "Style name" }).fill("Retained colour draft") }
                        if (scenario === "retained-tab") {
                            const count = await visibleSurface.count()
                            await page.evaluate(() => { const dialog = document.createElement("dialog"); dialog.id = "nested-native"; dialog.innerHTML = '<button>Native dialog control</button>'; document.body.append(dialog); dialog.showModal() })
                            await page.keyboard.press("Tab")
                            await page.keyboard.press("Escape")
                            await page.waitForFunction(() => !document.querySelector("#nested-native").open)
                            await page.evaluate(() => document.querySelector("#nested-native").remove())
                            assert.equal(await visibleSurface.count(), count, "custom handler yields to the newer native modal")
                        }
                        if (scenario === "invite-success") await page.getByRole("button", { name: "Invite to workspace", exact: true }).click()
                        if (["retained-tab", "hidden-remove", "invite-success"].includes(scenario)) await frame.evaluate(() => window.fixture.setActive(false))
                        if (scenario === "cached-page") {
                            const synchronous = await frame.evaluate(selector => {
                                window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }))
                                return [...window.parent.document.querySelectorAll(selector)].some(node => node.checkVisibility())
                            }, selector)
                            assert.equal(synchronous, false, "cached departure synchronously hides the exact popup")
                        }
                        if (scenario === "hidden-remove") await checkReleased()
                        if (scenario === "remove" || scenario === "hidden-remove") await page.locator("iframe").evaluate(node => node.remove())
                        if (scenario === "navigate") await frame.goto(`${origin}blank`)
                        if (scenario === "reload") { await frame.evaluate(() => location.reload()); await frame.waitForFunction(() => !!window.fixture) }
                        await checkReleased()
                        if (["remove", "hidden-remove", "navigate", "reload"].includes(scenario)) {
                            assert.equal(await page.locator(selector).count(), 0, "departed iframe leaves no visible or hidden owned portal DOM")
                        } else {
                            if (scenario === "cached-page") await frame.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })))
                            if (scenario === "invite-success") { await frame.evaluate(() => window.fixture.resolveInvite()); await frame.waitForTimeout(100) }
                            await frame.evaluate(() => window.fixture.setActive(true))
                            await page.waitForTimeout(120)
                            assert.equal(await visibleSurface.count(), 0, "returning to a tab must not resurrect its popup")
                            await open()
                            if (name === "service editor" || name === "initial service") assert.equal(await page.getByRole("textbox", { name: "Name", exact: true }).inputValue(), "Retained service draft")
                            if (name === "invitation") assert.equal(await page.getByRole("textbox", { name: "Username or email" }).inputValue(), scenario === "invite-success" ? "" : "ab")
                            if (name === "colour editor") assert.equal(await page.getByRole("textbox", { name: "Style name" }).inputValue(), "Retained colour draft")
                            if (scenario === "invite-success") assert.equal(lookups.length, 1, "acknowledged invitation is reset without another lookup")
                            if (name === "service templates") {
                                await page.getByRole("button", { name: /Add your own/ }).click()
                                await page.getByRole("dialog", { name: "New service", exact: true }).waitFor()
                                assert.equal(await page.getByRole("textbox", { name: "Name", exact: true }).inputValue(), "")
                                assert.equal(await page.getByRole("dialog", { name: "Service Templates", exact: true }).count(), 0)
                            }
                        }
                        assert.deepEqual(requests, [], "presentation transitions must not request data or write")
                        assert.deepEqual(errors, [])
                        results.push({ engine, framed, name, scenario, strict, passed: true })
                    } catch (error) { results.push({ engine, framed, name, scenario, strict, passed: false, error: String(error), errors }); if (!process.env.SETTINGS_POPUP_BASELINE) throw error }
                    finally { await context.close() }
                }
            }
        } finally { await browser.close() }
    }
} finally {
    server.kill("SIGTERM")
    const suffix = process.env.SETTINGS_POPUP_BASELINE ? "-baseline" : strict ? "-strict" : ""
    await writeFile(`browser-results/settings-popup-ownership${suffix}.json`, JSON.stringify(results, null, 2))
    console.log(`${results.filter(result => result.passed).length}/${results.length} settings popup ownership checks passed`)
    if (results.some(result => !result.passed)) process.exitCode = 1
}
