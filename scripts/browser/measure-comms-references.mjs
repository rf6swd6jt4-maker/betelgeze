import { spawn } from "node:child_process"
import { mkdir, writeFile } from "node:fs/promises"
import { chromium, webkit } from "playwright"

const baseline = process.argv[2]
if (!/^[a-f0-9]{7,40}$/.test(baseline ?? "")) throw Error("Pass the exact baseline Git commit")
const servers = []
function start(variant) {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, ["scripts/serve-comms-reference-performance.mjs"], { env: { ...process.env, ...(variant === "baseline" ? { COMMS_REFERENCE_BASELINE: baseline } : {}) }, stdio: ["ignore", "pipe", "pipe"] })
        servers.push(child)
        let output = ""
        const timeout = setTimeout(() => reject(Error(`${variant} fixture startup timeout: ${output}`)), 180000)
        child.stdout.on("data", chunk => { output += chunk; const url = output.match(/http:\/\/127\.0\.0\.1:\d+\//)?.[0]; if (url) { clearTimeout(timeout); resolve(url) } })
        child.stderr.on("data", chunk => { output = (output + chunk).slice(-24000) })
        child.once("error", error => { clearTimeout(timeout); reject(error) })
        child.once("exit", code => { clearTimeout(timeout); reject(Error(`${variant} fixture exited ${code}: ${output}`)) })
    })
}
const summarize = values => {
    const sorted = [...values].sort((a, b) => a - b)
    const percentile = fraction => sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)]
    return { count: sorted.length, median: percentile(.5), p95: percentile(.95), min: sorted[0], max: sorted.at(-1) }
}
const runs = []
try {
    const urls = { baseline: await start("baseline"), candidate: await start("candidate") }
    const stats = Object.fromEntries(await Promise.all(Object.entries(urls).map(async ([variant, url]) => [variant, await (await fetch(`${url}stats`)).json()])))
    for (const [engine, launcher] of Object.entries({ chromium, webkit })) {
        const browser = await launcher.launch({ headless: true })
        try {
            // ABBA order avoids attributing a monotonic warmup/drift to one revision.
            for (const variant of ["baseline", "candidate", "candidate", "baseline"]) {
                const url = urls[variant]
                const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" })
                const errors = []
                try {
                    await context.route("**/*", route => new URL(route.request().url()).origin === new URL(url).origin ? route.continue() : (errors.push("Non-loopback request blocked"), route.abort()))
                    const page = await context.newPage()
                    page.on("pageerror", error => errors.push(error.message))
                    await page.goto(url); await page.bringToFront()
                    await page.waitForFunction(() => window.commsReferencePerformance?.status === "complete", null, { timeout: 120000 })
                    const report = await page.evaluate(() => window.commsReferencePerformance)
                    if (errors.length || report.errors.length) throw Error(JSON.stringify({ errors, report }))
                    runs.push({ engine, variant, report, summary: Object.fromEntries(Object.entries(report.samples).filter(([, values]) => values.length).map(([name, values]) => [name, summarize(values)])) })
                    console.log(`${engine} ${variant}: plain reference requests=${report.referenceRequests - (variant === "candidate" ? 16 : 0)}`)
                } finally { await context.close() }
            }
        } finally { await browser.close() }
    }
    const summary = {}
    for (const engine of ["chromium", "webkit"]) for (const variant of ["baseline", "candidate"]) {
        const selected = runs.filter(run => run.engine === engine && run.variant === variant)
        const keys = Object.keys(selected[0].report.samples)
        summary[`${engine}:${variant}`] = Object.fromEntries(keys.flatMap(key => {
            const values = selected.flatMap(run => run.report.samples[key])
            return values.length ? [[key, summarize(values)]] : []
        }))
    }
    await mkdir("browser-results", { recursive: true })
    await writeFile("browser-results/comms-reference-performance.json", JSON.stringify({ baseline, measuredAt: new Date().toISOString(), stats, summary, runs, limits: "Production React/component code, unminified webpack production-mode bundles, identical synthetic 60-message data and desktop-host mobile viewport. Work duration and two-animation-frame paint observations are separate. Bundle bytes are fixture comparison, not Next production chunks. Not authenticated production, database, network, full shell, or physical device evidence." }, null, 2))
    console.log(JSON.stringify({ stats, summary }, null, 2))
} finally { for (const server of servers) server.kill("SIGTERM") }
