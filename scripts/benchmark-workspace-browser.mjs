/**
 * Controlled browser measurement, never a production load test.
 * Requires Playwright via BE_PLAYWRIGHT_MODULE or an existing playwright install.
 */
import { appendFileSync, mkdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { randomUUID } from "node:crypto"

const args = new Map(process.argv.slice(2).map((arg) => {
    const index = arg.indexOf("=")
    return index === -1 ? [arg, "true"] : [arg.slice(0, index), arg.slice(index + 1)]
}))
const base = new URL(args.get("--base-url") ?? "http://localhost:3000")
const local = ["localhost", "127.0.0.1", "[::1]"].includes(base.hostname)
if (!local && args.get("--allow-staging-origin") !== base.origin) throw new Error("Remote benchmarking requires --allow-staging-origin=<exact origin>. Never use production.")
if (!args.has("--cases")) throw new Error("Required --cases=<controlled fixture JSON>. See docs/workspace-performance-measurement.md.")
const count = Number(args.get("--iterations") ?? 100)
if (!Number.isInteger(count) || count < 1 || count > 500) throw new Error("Iterations must be between 1 and 500")
const cases = JSON.parse(readFileSync(args.get("--cases"), "utf8"))
if (!Array.isArray(cases) || cases.length === 0) throw new Error("Expected non-empty cases array")
for (const item of cases) {
    if (!/^[a-z][a-z0-9_.-]{0,70}$/.test(item.name ?? "") || typeof item.from !== "string" || typeof item.ready !== "string" || !item.ready) throw new Error("Each case needs a content-free name, from path and meaningful-ready selector")
    if (new URL(item.from, base).origin !== base.origin) throw new Error("Case URLs must stay on the selected origin")
    if (item.click && typeof item.click !== "string") throw new Error("click must be a selector")
    if (item.frame && typeof item.frame !== "string") throw new Error("frame must be a selector")
}
const playwrightModule = process.env.BE_PLAYWRIGHT_MODULE
const playwright = await import(playwrightModule ? pathToFileURL(path.resolve(playwrightModule)).href : "playwright")
const browserType = args.get("--browser") ?? "chromium"
if (!["chromium", "webkit"].includes(browserType)) throw new Error("Supported reference engines: chromium or webkit; WebKit emulation is not physical iPhone verification")
const output = path.resolve(args.get("--output") ?? "output/performance-browser/samples.jsonl")
mkdirSync(path.dirname(output), { recursive: true })
const browser = await playwright[browserType].launch({ headless: !args.has("--headed") })
const context = await browser.newContext({
    storageState: args.get("--storage-state") || undefined,
    viewport: { width: Number(args.get("--width") ?? 1440), height: Number(args.get("--height") ?? 960) },
    serviceWorkers: args.get("--service-workers") === "allow" ? "allow" : "block",
})
// Provider side effects and background send workers must also be disabled at the staging server.
// This request guard is a second layer, not a replacement for isolated data/accounts.
const allowWrites = args.get("--allow-staging-writes") === "true"
await context.route("**/*", (route) => {
    const request = route.request()
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method()) && (!allowWrites || new URL(request.url()).origin !== base.origin)) return route.abort("blockedbyclient")
    return route.continue()
})
const page = await context.newPage()
let failed = 0
try {
    for (const item of cases) {
        for (let iteration = 0; iteration < count; iteration++) {
            let transferBytes = 0
            let requestCount = 0
            let blockedOrFailedRequests = 0
            const finishedRequests = []
            const request = () => { requestCount++ }
            const failedRequest = () => { blockedOrFailedRequests++ }
            const requestFinished = (request) => {
                finishedRequests.push(request.sizes().then((sizes) => { transferBytes += sizes.responseBodySize + sizes.responseHeadersSize }).catch(() => {}))
            }
            // Establish the same starting screen outside the measured action interval.
            await page.goto(new URL(item.from, base).href, { waitUntil: "domcontentloaded" })
            if (item.fromReady) await page.locator(item.fromReady).waitFor({ state: "visible" })
            page.on("request", request)
            page.on("requestfailed", failedRequest)
            page.on("requestfinished", requestFinished)
            const started = await page.evaluate(() => {
                const state = { started: performance.now(), visible: document.visibilityState === "visible", changes: 0, hiddenAt: document.visibilityState === "visible" ? null : performance.now(), hidden: 0 }
                window.__BE_BENCHMARK__ = state
                document.addEventListener("visibilitychange", () => {
                    const now = performance.now()
                    if (state.hiddenAt !== null) state.hidden += now - state.hiddenAt
                    state.hiddenAt = document.visibilityState === "visible" ? null : now
                    state.changes++
                }, { signal: (window.__BE_BENCHMARK_ABORT__ = new AbortController()).signal })
                return { time: performance.timeOrigin + state.started, origin: performance.timeOrigin }
            })
            let outcome = "completed"
            let completionBoundary = "meaningful_ready"
            try {
                if (item.click) await page.locator(item.click).click({ timeout: 15_000 })
                else await page.reload({ waitUntil: "domcontentloaded" })
                const scope = item.frame ? page.frameLocator(item.frame) : page
                await scope.locator(item.ready).waitFor({ state: "visible", timeout: 30_000 })
                await scope.locator(item.ready).evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
            } catch {
                outcome = "timeout"
                completionBoundary = null
                failed++
            }
            const result = await page.evaluate(({ started }) => {
                const state = window.__BE_BENCHMARK__
                window.__BE_BENCHMARK_ABORT__?.abort()
                const now = performance.now()
                return {
                    durationMs: Math.max(0, performance.timeOrigin + now - started.time),
                    // New documents lose the old visibility listener. Do not certify the gap as foreground.
                    startedVisible: performance.timeOrigin === started.origin && state?.visible === true,
                    endedVisible: document.visibilityState === "visible",
                    visibilityChanges: state?.changes ?? 0,
                    hiddenDurationMs: state ? state.hidden + (state.hiddenAt === null ? 0 : now - state.hiddenAt) : 0,
                }
            }, { started })
            page.off("request", request)
            page.off("requestfailed", failedRequest)
            page.off("requestfinished", requestFinished)
            await Promise.allSettled(finishedRequests)
            const sample = {
                schemaVersion: 1, sampleId: randomUUID(), operation: item.operation ?? (item.click ? "navigation" : "launch"),
                command: "unknown", routeSection: item.routeSection ?? "unknown", cacheState: item.cacheState ?? "unknown",
                renderer: item.renderer ?? "unknown", background: false, outcome, completionBoundary, ...result,
                boundaries: completionBoundary ? { meaningful_ready: result.durationMs } : {}, suspended: false,
            }
            appendFileSync(output, `${JSON.stringify({ measurement: sample, case: item.name, iteration, browser: browserType, deployment: args.get("--deployment") ?? "unlabelled", requests: requestCount, blockedOrFailedRequests, observedTransferBytes: transferBytes, serviceWorkers: args.get("--service-workers") === "allow" ? "allow" : "block" })}\n`)
        }
        process.stdout.write(`${item.name}: ${count} observations recorded\n`)
    }
} finally { await browser.close() }
process.stdout.write(`Output: ${output}; timed-out observations: ${failed}\n`)
if (failed) process.exitCode = 1
