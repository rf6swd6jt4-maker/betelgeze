// Runs real application helper/component fixtures against loopback synthetic data.
// This is development tooling, not an authenticated or physical-device check.
import { spawn } from "node:child_process"
import { mkdir, writeFile } from "node:fs/promises"
import { chromium, webkit } from "playwright"
import { assertFixtureReport } from "./report.mjs"

const fixtures = [
 {name:"comms-pane-lifecycle-mobile",expected:13,script:"scripts/serve-comms-pane-lifecycle-fixture.mjs",global:"commsPaneLifecycleResult",viewport:{width:390,height:844}},
 {name:"comms-pane-lifecycle-desktop",expected:13,script:"scripts/serve-comms-pane-lifecycle-fixture.mjs",global:"commsPaneLifecycleResult",viewport:{width:1280,height:900}},
]
const selected = process.argv.slice(2)
if (selected.some(value => !["chromium", "webkit"].includes(value))) throw Error("Usage: run-comms-pane-lifecycle.mjs [chromium|webkit]")
const engines = selected.length ? selected : ["chromium", "webkit"]
const reports = []
const servers = []
function start(fixture) {
    const child = spawn(process.execPath, [fixture.script, ...(fixture.args ?? [])], { stdio: ["ignore", "pipe", "pipe"] })
    servers.push(child)
    let output = ""
    const ready = new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(Error(`Fixture startup timed out: ${fixture.name}`)), 90_000)
        const consume = chunk => {
            output = (output + chunk).slice(-24_000)
            const match = output.match(/http:\/\/127\.0\.0\.1:\d+\//)
            if (match) { clearTimeout(timer); resolve(match[0]) }
        }
        child.stdout.on("data", consume)
        child.stderr.on("data", chunk => { output = (output + chunk).slice(-24_000) })
        child.once("error", error => { clearTimeout(timer); reject(error) })
        child.once("exit", code => { clearTimeout(timer); reject(Error(`Fixture exited ${code}: ${output}`)) })
    })
    return ready
}
await mkdir("browser-results", { recursive: true })
try {
    for (const engine of engines) {
        const browser = await ({ chromium, webkit })[engine].launch({ headless: true })
        try {
            for (const fixture of fixtures) {
                const url = await start(fixture)
                const context = await browser.newContext({ viewport: fixture.viewport ?? { width: 1280, height: 900 }, ...(fixture.reducedMotion ? { reducedMotion: fixture.reducedMotion } : {}) })
                const unexpected = [], errors = []
                await context.route("**/*", route => {
                    const requestUrl = new URL(route.request().url())
                    if (requestUrl.origin === new URL(url).origin) return route.continue()
                    unexpected.push(requestUrl.origin)
                    return route.abort()
                })
                const page = await context.newPage()
                page.on("pageerror", error => errors.push(error.message))
                let report
                try {
                    await page.goto(url + (fixture.query ?? ""))
                    await page.bringToFront()
                    await page.waitForFunction(key => {
                        const data = key ? window[key] : (() => { try { return JSON.parse(document.querySelector("#result")?.textContent ?? "") } catch { return null } })()
                        return data && Number.isInteger(data.total) && Array.isArray(data.cases) && (!data.status || data.status === "complete")
                    }, fixture.global, { timeout: 180_000 })
                    report = await page.evaluate(key => key ? window[key] : JSON.parse(document.querySelector("#result").textContent), fixture.global)
                    assertFixtureReport(report, fixture.expected)
                    if (unexpected.length || errors.length) throw Error(`Unexpected network/page errors: ${JSON.stringify({ unexpected, errors })}`)
                    reports.push({ engine, fixture: fixture.name, outcome: "passed", report })
                    console.log(`${engine} ${fixture.name}: ${report.passed}/${report.total}`)
                } catch (error) {
                    const text = await page.locator("#result").textContent().catch(() => "unavailable")
                    reports.push({ engine, fixture: fixture.name, outcome: "failed", report, error: String(error), text, unexpected, errors })
                    await page.screenshot({ path: `browser-results/${engine}-${fixture.name}.png` }).catch(() => {})
                    if (!process.env.COMMS_PANE_BASELINE) throw error
                } finally {
                    await context.close()
                    const child = servers.pop()
                    child?.kill("SIGTERM")
                }
            }
        } finally { await browser.close() }
    }
} finally {
    for (const server of servers) server.kill("SIGTERM")
    await writeFile(process.env.COMMS_PANE_REPORT ?? "browser-results/comms-pane-lifecycle.json", JSON.stringify({ observedAt: new Date().toISOString(), reports, limits: "Loopback synthetic component/helper checks. Not production latency, authenticated UI or physical-device evidence." }, null, 2))
}

if (reports.some(report => report.outcome === "failed")) process.exitCode = 1
