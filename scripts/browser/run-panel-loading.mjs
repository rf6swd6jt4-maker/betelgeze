import { spawn } from "node:child_process"
import { mkdir, writeFile } from "node:fs/promises"
import assert from "node:assert/strict"
import { chromium, webkit } from "playwright"

const selected = process.argv.slice(2)
if (selected.some(engine => !["chromium", "webkit"].includes(engine))) throw Error("Use chromium and/or webkit")
const server = spawn(process.execPath, ["scripts/serve-panel-loading-fixture.mjs"], { stdio: ["ignore", "pipe", "pipe"] })
const output = process.env.PANEL_LOADING_OUTPUT ?? "browser-results/panel-loading"
const report = process.env.PANEL_LOADING_REPORT ?? "browser-results/panel-loading.json"
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
    const scenarios = [
        ["work-items", "route"], ["work-items", "opening"], ["work-items", "reference"], ["work-items", "reference", "limited"],
        ["sops", "route"], ["sops", "reference"], ["sops", "reference", "limited"],
        ["assets", "route"], ["notes", "route"], ["relationships", "route"], ["relationships", "reference"], ["onboarding", "route"], ["onboarding", "reference"], ["queue", "route"],
        ["client-connections", "route"], ["fulfilment", "route"], ["leadgen", "route"], ["leadgen-polls", "route"],
        ["admin", "route"], ["admin-activity", "route"], ["admin-maintenance", "route"], ["admin-okrs", "route"],
        ["communications", "route"], ["communications", "opening"], ["communications-team", "route"], ["settings", "route"], ["settings", "opening"], ["detail", "route"], ["detail", "opening"],
    ]
    const viewports = [{ name: "mobile", width: 390, height: 844, reducedMotion: "reduce" }, { name: "mobile-motion", width: 390, height: 844, reducedMotion: "no-preference" }, { name: "narrow", width: 320, height: 700, reducedMotion: "reduce" }, { name: "desktop", width: 1280, height: 900, reducedMotion: "reduce" }]
    for (const engine of selected.length ? selected : ["chromium", "webkit"]) {
        const browser = await ({ chromium, webkit })[engine].launch({ headless: true })
        try {
            for (const viewport of viewports) {
                const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, reducedMotion: viewport.reducedMotion })
                const external = [], errors = []
                await context.route("**/*", route => { if (new URL(route.request().url()).origin === new URL(origin).origin) return route.continue(); external.push(route.request().url()); return route.abort() })
                try {
                    const page = await context.newPage()
                    page.on("pageerror", error => errors.push(error.message))
                    for (const [variant, stage, role] of scenarios) {
                        const params = new URLSearchParams({ variant, stage })
                        if (role) params.set(role, "1")
                        const id = `${engine}-${viewport.name}-${variant}-${stage}${role ? `-${role}` : ""}`
                        await page.goto(`${origin}?${params}`, { waitUntil: "load" })
                        await page.locator(stage === "reference" ? "[data-fixture-panel] h1" : "[data-workspace-loading-root]").waitFor({ state: "attached", timeout: 15_000 })
                        const firstFrameRowVisible = stage === "route" && variant === "work-items" && viewport.width === 390
                            ? await page.evaluate(() => document.querySelector('[data-fixture-panel] [role="listitem"]')?.checkVisibility({ contentVisibilityAuto: true }) ?? false)
                            : null
                        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
                        const measurement = await page.evaluate(() => {
                            const panel = document.querySelector("[data-fixture-panel]")
                            const root = document.querySelector("[data-workspace-loading-root]")
                            const h1 = panel.querySelector("h1")
                            const tabs = panel.querySelector("[data-panel-tab-strip]")
                            const headerAction = panel.querySelector("header > div:nth-child(2)")
                            const stats = panel.querySelector('[aria-label="Onboarding statistics for this page"], [aria-label="Loading statistics"]')
                            const filters = panel.querySelector('[aria-label="Synthetic filters"], [aria-label="Loading filters"]')?.closest("section")
                            const list = panel.querySelector('[role="list"]')
                            const firstRow = list?.querySelector('[role="listitem"]')
                            const box = node => { const rect = node?.getBoundingClientRect(); return rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null }
                            return { headingCount: panel.querySelectorAll("h1").length, heading: h1?.textContent ?? null, headingBox: box(h1), tabsBox: box(tabs), actionBox: box(headerAction), statsBox: box(stats), filtersBox: box(filters), listBox: box(list), rowBox: box(firstRow), tabs: tabs ? [...tabs.querySelectorAll("a,span")].map(node => node.textContent) : [], tabFaces: tabs ? [...tabs.children].map(node => getComputedStyle(node).backgroundColor) : [], busyRoots: panel.querySelectorAll('[data-workspace-loading-root][aria-busy="true"]').length, interactiveCount: panel.querySelectorAll("button,a,input,select,textarea,[tabindex]:not([tabindex='-1'])").length, bannerCount: panel.querySelectorAll("[data-workspace-shared-banner]").length, startupCount: panel.querySelectorAll("[data-app-startup], [aria-label='Loading Betelgeze']").length, overflow: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth, panel.scrollWidth) - innerWidth, panelBox: box(panel), rootBox: box(root), animatedCount: [...panel.querySelectorAll('[class*="animate-pulse"]')].filter(node => getComputedStyle(node).animationName !== "none").length }
                        })
                        const record = { engine, viewport: viewport.name, variant, stage, role: role ?? null, firstFrameRowVisible, ...measurement, screenshot: `${id}.png` }
                        observations.push(record)
                        assert.equal(measurement.headingCount, ["communications", "communications-team", "detail"].includes(variant) ? 0 : 1, `${id}: unexpected h1 count`)
                        if (stage !== "reference") {
                            assert.equal(measurement.busyRoots, 1, `${id}: expected one busy loading root`)
                            assert.equal(measurement.interactiveCount, 0, `${id}: loading state must not expose controls`)
                            assert(!measurement.tabFaces.includes("rgb(255, 255, 255)"), `${id}: pending tabs must not look like finished white controls`)
                            assert.equal(measurement.bannerCount, 0, `${id}: duplicate banner`)
                            assert.equal(measurement.startupCount, 0, `${id}: startup branding in panel`)
                        }
                        assert(measurement.overflow <= 1, `${id}: horizontal overflow ${measurement.overflow}px`)
                        if (firstFrameRowVisible !== null) assert.equal(firstFrameRowVisible, true, `${id}: first visible skeleton row skipped by content-visibility`)
                        await page.screenshot({ path: `${output}/${id}.png`, fullPage: false, animations: "disabled" })
                    }
                    assert.deepEqual(external, [], `${engine}/${viewport.name}: external requests`)
                    assert.deepEqual(errors, [], `${engine}/${viewport.name}: page errors`)
                    const find = (variant, stage, role = null) => observations.find(item => item.engine === engine && item.viewport === viewport.name && item.variant === variant && item.stage === stage && item.role === role)
                    for (const variant of ["work-items", "communications", "settings", "detail"]) {
                        const route = find(variant, "route"), opening = find(variant, "opening")
                        assert.equal(opening.heading, route.heading, `${engine}/${viewport.name}/${variant}: opening title differs from route`)
                        if (route.headingBox) assert(Math.abs(opening.headingBox.y - route.headingBox.y) <= 1, `${engine}/${viewport.name}/${variant}: opening heading moves`)
                    }
                    for (const role of [null, "limited"]) {
                        const reference = find("work-items", "reference", role), loading = find("work-items", "route")
                        if (loading.tabsBox) assert(Math.abs(loading.tabsBox.y - reference.tabsBox.y) <= 2, `${engine}/${viewport.name}: Library tabs jump`)
                    }
                    const close = (actual, expected, label, tolerance = 2) => { assert(actual && expected, `${engine}/${viewport.name}: missing ${label}`); assert(Math.abs(actual - expected) <= tolerance, `${engine}/${viewport.name}: ${label} moves ${Math.round(actual - expected)}px`) }
                    for (const variant of ["relationships", "onboarding"]) {
                        const reference = find(variant, "reference"), loading = find(variant, "route")
                        close(loading.headingBox.y, reference.headingBox.y, `${variant} heading`)
                        close(loading.filtersBox.y, reference.filtersBox.y, `${variant} filters`)
                        close(loading.listBox.y, reference.listBox.y, `${variant} list`)
                        close(loading.listBox.width, reference.listBox.width, `${variant} list width`)
                        if (variant === "onboarding") close(loading.statsBox.y, reference.statsBox.y, "onboarding statistics")
                        if (variant === "relationships") {
                            close(loading.actionBox.y, reference.actionBox.y, "relationship action slot y", 4)
                            close(loading.actionBox.height, reference.actionBox.height, "relationship action slot height", 4)
                        }
                    }
                    console.log(`${engine} ${viewport.name}: ${scenarios.length} loading/reference states passed`)
                } finally { await context.close() }
            }
            const normal = observations.filter(item => item.engine === engine && item.viewport === "mobile-motion")
            const reduced = observations.filter(item => item.engine === engine && item.viewport === "mobile")
            for (let index = 0; index < normal.length; index++) {
                const stableGeometry = ({ headingBox, tabsBox, actionBox, statsBox, filtersBox, listBox, panelBox, rootBox, ...item }) => ({
                    headingBox, tabsBox, actionBox, statsBox, filtersBox,
                    listBox: listBox && { x: listBox.x, y: listBox.y, width: listBox.width },
                    panelBox, rootBox,
                    headingCount: item.headingCount, busyRoots: item.busyRoots, interactiveCount: item.interactiveCount,
                    bannerCount: item.bannerCount, startupCount: item.startupCount, overflow: item.overflow,
                })
                assert.deepEqual(stableGeometry(normal[index]), stableGeometry(reduced[index]), `${engine}: motion changes loading structure or first-screen geometry for ${normal[index].variant}/${normal[index].stage}`)
                if (normal[index].stage !== "reference") assert.equal(reduced[index].animatedCount, 0, `${engine}: reduced motion still animates ${normal[index].variant}`)
            }
        } finally { await browser.close() }
    }
} finally {
    server.kill("SIGTERM")
    await writeFile(report, JSON.stringify({ observations, limits: "Actual components and CSS with synthetic props; local browser rendering only. No authenticated route, production data, provider, or physical-device claim." }, null, 2))
}
