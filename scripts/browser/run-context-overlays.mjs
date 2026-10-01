import { spawn } from "node:child_process"
import { mkdir, writeFile } from "node:fs/promises"
import assert from "node:assert/strict"
import { chromium, webkit } from "playwright"
const engines = process.argv.slice(2)
if (engines.some(engine => !["chromium", "webkit"].includes(engine))) throw Error("Use chromium and/or webkit")
const server = spawn(process.execPath, ["scripts/serve-context-overlays-fixture.mjs"], { stdio: ["ignore", "pipe", "pipe"] })
const reports = []
await mkdir("browser-results/context-overlays", { recursive: true })
try {
    const origin = await new Promise((resolve, reject) => {
        let log = ""
        const timer = setTimeout(() => reject(Error(`Fixture startup timeout: ${log}`)), 90000)
        const consume = chunk => { log += chunk; const url = log.match(/http:\/\/127\.0\.0\.1:\d+\//); if (url) { clearTimeout(timer); resolve(url[0]) } }
        server.stdout.on("data", consume); server.stderr.on("data", consume)
        server.once("exit", code => { clearTimeout(timer); reject(Error(`Fixture exit ${code}: ${log}`)) })
    })
    for (const [engine, implementation] of Object.entries({ chromium, webkit }).filter(([engine]) => !engines.length || engines.includes(engine))) {
        const browser = await implementation.launch({ headless: true })
        try {
            for (const [name, viewport, reducedMotion] of [["mobile", { width: 390, height: 844 }, "no-preference"], ["narrow", { width: 320, height: 568 }, "reduce"], ["desktop", { width: 1280, height: 900 }, "reduce"]]) {
                const context = await browser.newContext({ viewport, reducedMotion })
                const errors = [], external = [], cases = []
                await context.route("**/*", route => { if (new URL(route.request().url()).origin === new URL(origin).origin) return route.continue(); external.push(route.request().url()); return route.abort() })
                const page = await context.newPage(); page.on("pageerror", error => errors.push(error.message))
                const check = async (name, run) => { await run(); cases.push(name) }
                try {
                    await page.goto(origin); await page.locator("#context-trigger").waitFor()
                    if (name !== "desktop") {
                        await check("right drawer, stationary backdrop and reduced-motion policy", async () => {
                            await page.locator("#context-trigger").click()
                            const drawer = page.locator("[data-side-drawer]"); await drawer.waitFor()
                            const result = await drawer.evaluate(node => ({ animation: getComputedStyle(node).animationName, backdropAnimation: getComputedStyle(node.parentElement).animationName }))
                            assert.equal(result.animation, reducedMotion === "reduce" ? "none" : "betelgeze-drawer-right-in")
                            assert.equal(result.backdropAnimation, "none")
                            await page.waitForTimeout(230)
                            const box = await drawer.boundingBox(); assert(box.x >= 47); assert(Math.abs(box.x + box.width - viewport.width) <= 1)
                            const header = await page.locator("[data-workspace-topbar]").boundingBox()
                            assert.equal(box.y, header.y + header.height, "drawer must start below intact shell header")
                            assert.equal(box.y + box.height, viewport.height, "drawer must stay inside the shell viewport")
                            assert.equal(await page.locator("dialog:modal").count(), 0, "shell drawer must not make the app header inert")
                            assert.equal(await page.locator("[data-workspace-tabbar]").evaluate(node => node.inert), true)
                            await page.locator("#shell-header-action").click()
                            assert.equal(await page.evaluate(() => window.headerClicks), 1)
                            assert.equal(await page.locator("dialog[open]").count(), 1)
                            assert.equal(await page.locator('dialog [aria-current="page"]').count(), 1)
                            await page.screenshot({ path: `browser-results/context-overlays/${engine}-${name}.png` })
                        })
                        await check("drawer reuses shell visual viewport bounds without moving the header", async () => {
                            await page.evaluate(() => {
                                const root = document.querySelector("[data-workspace-shell-root]")
                                root.dataset.mobileCommsViewport = "true"
                                for (const [name, value] of Object.entries({ "--mobile-workspace-top": "34px", "--mobile-workspace-height": "480px", "--mobile-workspace-header-height": "56px", "--mobile-workspace-tabs-height": "44px" })) root.style.setProperty(name, value)
                            })
                            const header = await page.locator("[data-workspace-topbar]").boundingBox()
                            const drawer = await page.locator("[data-side-drawer]").boundingBox()
                            assert.equal(header.y, 34); assert.equal(drawer.y, 90)
                            assert.equal(drawer.height, 424); assert.equal(drawer.y + drawer.height, 514)
                            await page.evaluate(() => {
                                const root = document.querySelector("[data-workspace-shell-root]")
                                delete root.dataset.mobileCommsViewport
                                root.removeAttribute("style")
                            })
                        })
                        await check("Escape leaves a newer non-native modal above the drawer", async () => {
                            await page.evaluate(() => {
                                const modal = document.createElement("div")
                                modal.id = "header-profile-test"
                                modal.setAttribute("role", "dialog"); modal.setAttribute("aria-modal", "true")
                                modal.textContent = "Header profile"
                                modal.style.cssText = "position:fixed;inset:0;z-index:180;background:#111"
                                document.body.append(modal)
                            })
                            await page.keyboard.press("Escape")
                            assert.equal(await page.locator("[data-workspace-side-drawer][open]").count(), 1)
                            await page.evaluate(() => document.querySelector("#header-profile-test").remove())
                        })
                        await check("close releases backdrop and restores trigger focus", async () => {
                            await page.getByRole("button", { name: "Close relationship context", exact: true }).click()
                            assert.equal(await page.evaluate(() => window.drawerOpenAtClose), false, "close must release the drawer before parent callback")
                            assert.equal(await page.locator("dialog[open], [data-side-drawer]").count(), 0)
                            assert.equal(await page.evaluate(() => document.activeElement.id), "context-trigger")
                            await page.locator("#background").click()
                            assert.equal(await page.locator("[data-workspace-tabbar]").evaluate(node => node.inert), false)
                        })
                        await check("reopen, Escape and backdrop dismiss immediately", async () => {
                            await page.locator("#context-trigger").click(); await page.keyboard.press("Escape")
                            assert.equal(await page.locator("dialog[open]").count(), 0)
                            await page.locator("#context-trigger").click(); await page.mouse.click(10, viewport.height / 2)
                            assert.equal(await page.locator("dialog[open]").count(), 0)
                        })
                        await check("shortcut preserves selected client and dismisses drawer", async () => {
                            await page.locator("#context-trigger").click()
                            await page.getByRole("link", { name: "Client Connections" }).click()
                            assert.equal(await page.evaluate(() => window.lastContextDestination), "/fixture/client-connections?relationship=client-a")
                            assert.equal(await page.locator("dialog[open]").count(), 0)
                        })
                        await check("desktop resize and owner unmount release top layer", async () => {
                            await page.locator("#context-trigger").click(); await page.setViewportSize({ width: 1280, height: 900 })
                            await page.waitForFunction(() => !document.querySelector("dialog[open]"))
                            await page.setViewportSize(viewport); await page.locator("#context-trigger").click()
                            await page.evaluate(() => window.fixture.setMounted(false))
                            await page.waitForFunction(() => !document.querySelector("dialog[open]"))
                            await page.locator("#background").click()
                        })
                    } else {
                        await check("desktop context identity and canonical shortcuts", async () => {
                            const aside = page.getByRole("complementary", { name: "Relationship context" }); await aside.waitFor()
                            assert.equal(await aside.getByRole("link", { name: "Client Connections" }).getAttribute("href"), "/fixture/client-connections?relationship=client-a")
                            assert.equal(await aside.locator('[aria-current="page"]').count(), 1)
                            await page.screenshot({ path: `browser-results/context-overlays/${engine}-${name}.png` })
                        })
                    }
                    await check("native tab hides modal without losing draft or stealing focus", async () => {
                        await page.locator("#modal-trigger").click(); await page.getByRole("textbox", { name: "Draft" }).fill("Keep this edit")
                        await page.evaluate(() => window.fixture.setActive(false))
                        await page.waitForFunction(() => !document.querySelector("dialog[open]"))
                        await page.locator("#background").click()
                        await page.evaluate(() => window.fixture.setActive(true))
                        await page.getByRole("textbox", { name: "Draft" }).waitFor(); assert.equal(await page.getByRole("textbox", { name: "Draft" }).inputValue(), "Keep this edit")
                        await page.getByRole("button", { name: "Close popup" }).click()
                        assert.equal(await page.locator("dialog[open]").count(), 0)
                    })
                    await check("iframe tab releases portalled backdrop when inactive", async () => {
                        await page.evaluate(() => { document.body.dataset.workspaceActiveTabId = "fixture-frame"; const frame = document.createElement("iframe"); frame.id = "owner-frame"; frame.name = "betelgeze-tab:fixture-frame"; frame.src = "/?__betelgeze_tab=fixture-frame"; document.body.append(frame) })
                        const frame = page.frameLocator("#owner-frame"); await frame.locator("#modal-trigger").click()
                        await page.getByRole("textbox", { name: "Draft" }).waitFor()
                        await page.evaluate(() => { document.body.dataset.workspaceActiveTabId = "other"; const frame = document.querySelector("iframe"); frame.hidden = true; frame.contentWindow.dispatchEvent(new Event("betelgeze:workspace-tab-visibility")) })
                        await page.waitForFunction(() => !document.querySelector("dialog[open]"))
                        await page.locator("#background").click()
                        assert.notEqual(await page.evaluate(() => document.activeElement.id), "owner-frame")
                        await page.evaluate(() => document.querySelector("iframe").remove())
                    })
                    await check("client connection filter changes never retarget a draft or choose another client", async () => {
                        await page.goto(origin + "?connections")
                        await page.waitForFunction(() => Boolean(window.fixture))
                        await page.evaluate(() => window.fixture.setUrl("/fixture/client-connections?relationship=client-a"))
                        const add = page.getByRole("button", { name: "Add connection" })
                        await add.click()
                        assert.equal(await page.locator('dialog input[name="relationshipId"]').inputValue(), "client-a")
                        await page.evaluate(() => window.fixture.setUrl("/fixture/client-connections?relationship=client-b"))
                        assert.equal(await page.locator('dialog input[name="relationshipId"]').inputValue(), "client-a")
                        await page.getByRole("button", { name: "Close popup" }).click()
                        await add.click()
                        assert.equal(await page.locator('dialog input[name="relationshipId"]').inputValue(), "client-b")
                        await page.getByRole("button", { name: "Close popup" }).click()
                        await page.evaluate(() => window.fixture.setUrl("/fixture/client-connections?relationship=client-c"))
                        await page.waitForFunction(() => [...document.querySelectorAll("button")].find(node => node.textContent.includes("Add connection"))?.disabled)
                        assert.equal(await add.isDisabled(), true)
                        await page.evaluate(() => window.fixture.setUrl("/fixture/client-connections?relationship=unknown"))
                        assert.equal(await add.isDisabled(), true)
                    })
                    if (name !== "desktop") await check("standalone context retains native full-viewport modality", async () => {
                        await page.goto(origin + "?standalone")
                        await page.locator("#context-trigger").click()
                        await page.locator("dialog:modal").waitFor()
                        const drawer = await page.locator("[data-side-drawer]").boundingBox()
                        assert.equal(drawer.y, 0); assert.equal(drawer.height, viewport.height)
                        await page.keyboard.press("Escape")
                        assert.equal(await page.locator("dialog[open]").count(), 0)
                        assert.equal(await page.evaluate(() => document.activeElement.id), "context-trigger")
                    })
                    assert.deepEqual(errors, []); assert.deepEqual(external, [])
                    reports.push({ engine, viewport: name, passed: cases.length, cases }); console.log(`${engine}/${name}: ${cases.length} passed`)
                } catch (error) { reports.push({ engine, viewport: name, cases, error: String(error), errors, external }); throw error }
                finally { await context.close() }
            }
        } finally { await browser.close() }
    }
} finally {
    server.kill("SIGTERM")
    await writeFile("browser-results/context-overlays.json", JSON.stringify({ reports, limits: "Synthetic production React and actual CSS. No authenticated or physical-device evidence." }, null, 2))
}
