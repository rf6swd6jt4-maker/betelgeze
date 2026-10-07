// Separate browser contexts intentionally cannot share the local BroadcastChannel.
import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { mkdir, writeFile } from "node:fs/promises"
import { chromium, webkit } from "playwright"
const engines = process.argv.slice(2)
if (engines.some(engine => !["chromium", "webkit"].includes(engine))) throw Error("Usage: run-comms-convergence.mjs [chromium|webkit]")
const baseline = Boolean(process.env.COMMS_CONVERGENCE_BASELINE)
const reports = [], pageErrors = []
const server = spawn(process.execPath, ["scripts/serve-comms-convergence-fixture.mjs"], { stdio: ["ignore", "pipe", "pipe"], env: process.env })
let logs = ""
const url = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error("Fixture startup timed out: " + logs.slice(-2000))), 90_000)
    server.stdout.on("data", data => { logs += data; const match = logs.match(/http:\/\/127\.0\.0\.1:\d+\//); if (match) { clearTimeout(timer); resolve(match[0]) } })
    server.stderr.on("data", data => { logs += data })
    server.once("error", error => { clearTimeout(timer); reject(error) })
    server.once("exit", code => { clearTimeout(timer); reject(Error(`Fixture exited ${code}: ${logs.slice(-4000)}`)) })
})
const read = page => page.evaluate(() => window.commsConvergence.state)
const until = (page, predicate) => page.waitForFunction(predicate, null, { timeout: 5000 })
async function load(page, kind) { await page.goto(`${url}?kind=${kind}`); await until(page, () => window.commsConvergence?.state.loaded && window.commsConvergence.state.row === 3); await page.waitForTimeout(30) }
async function assertCleared(page) { await until(page, () => window.commsConvergence.state.row === 0 && window.commsConvergence.state.shell === 0) }
async function settledScrollPosition(locator) {
    return locator.evaluate(node => new Promise((resolve, reject) => {
        let position = node.scrollTop, changedAt = performance.now(), frame = 0
        const deadline = setTimeout(() => { cancelAnimationFrame(frame); reject(Error("Wheel scrolling did not settle within five seconds")) }, 5000)
        const sample = now => {
            if (node.scrollTop !== position) { position = node.scrollTop; changedAt = now }
            if (position > 0 && now - changedAt >= 250) { clearTimeout(deadline); resolve(position); return }
            frame = requestAnimationFrame(sample)
        }
        frame = requestAnimationFrame(sample)
    }))
}
try {
    for (const engine of engines.length ? engines : ["chromium", "webkit"]) {
        const browser = await ({ chromium, webkit })[engine].launch({ headless: true })
        try {
            for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 900 }]) for (const kind of ["client", "native"]) {
                const contexts = await Promise.all([browser.newContext({ viewport }), browser.newContext({ viewport })])
                try {
                    for (const context of contexts) await context.route("**/*", route => new URL(route.request().url()).origin === new URL(url).origin ? route.continue() : route.abort())
                    const [sender, receiver] = await Promise.all(contexts.map(context => context.newPage()))
                    for (const page of [sender, receiver]) page.on("pageerror", error => pageErrors.push(error.message))
                    await load(sender, kind); await load(receiver, kind)
                    await sender.evaluate(() => { window.commsConvergence.summary([]); window.commsConvergence.acknowledge() })
                    await assertCleared(sender); await receiver.waitForTimeout(80)
                    assert.equal((await read(receiver)).row, 3, "Separate devices must not share local BroadcastChannel delivery")
                    await receiver.evaluate(() => window.commsConvergence.summary([], "hold"))
                    const before = await read(receiver)
                    await receiver.evaluate(() => window.commsConvergence.remote())
                    if (baseline) { await receiver.waitForTimeout(120); assert.equal((await read(receiver)).row, 3, "Baseline hosted event must reproduce the stale badge") }
                    else await assertCleared(receiver)
                    const after = await read(receiver)
                    assert.equal(after.cursor?.slice(-12), "000000000003", "Actual workspace handler must merge the remote cursor")
                    assert.equal(after.counters.summary - before.counters.summary, baseline ? 0 : 1, "Only existing owner may reconcile once")
                    await receiver.evaluate(() => window.commsConvergence.duplicate())
                    await receiver.waitForTimeout(40)
                    assert.equal((await read(receiver)).counters.summary, after.counters.summary, "Duplicate cursor deliveries must not multiply requests")
                    if (baseline) await receiver.evaluate(() => window.commsConvergence.invalidate())
                    await receiver.evaluate(() => { window.commsConvergence.summary([], "fail"); window.commsConvergence.settle(true) })
                    await until(receiver, () => window.commsConvergence.state.stale)
                    assert.equal((await read(receiver)).row, baseline ? 3 : 0, "Failed summary must retain authoritative acknowledged reads")
                    reports.push({ engine, viewport, kind, case: "remote confirmed read with shell event omitted", baseline, baselineStuckAfterMs: baseline ? 120 : null, badgeCommitMs: after.observations.at(-1) ?? null, summaryRequests: after.counters.summary - before.counters.summary, duplicateRequests: 0, passed: true })

                    await load(receiver, kind)
                    await receiver.evaluate(() => window.commsConvergence.summary([], "hold"))
                    const priorSnapshot = await read(receiver)
                    await receiver.evaluate(() => window.commsConvergence.snapshot())
                    if (baseline) { await receiver.waitForTimeout(40); assert.equal((await read(receiver)).row, 3) } else await assertCleared(receiver)
                    const afterSnapshot = await read(receiver)
                    assert.equal(afterSnapshot.counters.summary - priorSnapshot.counters.summary, 1, "Snapshot must reuse one summary reconciliation")
                    await receiver.evaluate(() => { window.commsConvergence.summary([], "immediate"); window.commsConvergence.settle() })
                    await assertCleared(receiver)
                    reports.push({ engine, viewport, kind, case: "HTTP cursor recovery before slow summary", baseline, badgeCommitMs: afterSnapshot.observations.at(-1) ?? null, summaryRequests: 1, snapshotRequests: afterSnapshot.counters.snapshot, passed: true })
                    const batches = (await read(receiver)).counters.readBatches
                    await receiver.evaluate(() => window.commsConvergence.snapshot())
                    await receiver.waitForTimeout(30)
                    assert.equal((await read(receiver)).counters.readBatches, batches, "Unchanged snapshots must not rebroadcast all cursors")

                    await load(receiver, kind)
                    await receiver.evaluate(() => window.commsConvergence.summary([], "hold"))
                    const beforeMessage = await read(receiver)
                    await receiver.evaluate(() => { window.commsConvergence.messageEvent(); window.commsConvergence.messageEvent() })
                    await receiver.waitForTimeout(30)
                    assert.equal((await read(receiver)).counters.summary - beforeMessage.counters.summary, baseline ? 0 : 1, "Hosted message events must reach owner without duplicate reads")
                    reports.push({ engine, viewport, kind, case: "hosted message bridge deduplicates duplicate event", baseline, summaryRequests: baseline ? 0 : 1, passed: true })

                    if (kind === "native") {
                        await load(receiver, kind)
                        await receiver.evaluate(() => { const rows = window.commsConvergence.rows(3); rows[0].count = 1; window.commsConvergence.summary(rows, "hold") })
                        const beforeMutationSnapshot = await read(receiver)
                        await receiver.evaluate(() => window.commsConvergence.snapshot(2, false))
                        await receiver.waitForTimeout(30)
                        assert.equal((await read(receiver)).row, 3, "Partial read cannot clear the unread latest message")
                        assert.equal((await read(receiver)).counters.summary - beforeMutationSnapshot.counters.summary, baseline ? 0 : 1, "Mutation snapshot must reconcile only when a confirmed read advances")
                        if (baseline) await receiver.evaluate(() => window.commsConvergence.invalidate())
                        await receiver.evaluate(() => window.commsConvergence.settle())
                        await until(receiver, () => window.commsConvergence.state.row === 1)
                        reports.push({ engine, viewport, kind, case: "partial read learned during mutation snapshot reconciles", baseline, summaryRequests: baseline ? 0 : 1, passed: true })
                    }

                    await load(receiver, kind)
                    await receiver.evaluate(() => { window.commsConvergence.summary(window.commsConvergence.rows(4)); window.commsConvergence.invalidate() })
                    await until(receiver, () => window.commsConvergence.state.row === 4)
                    await receiver.evaluate(() => { const rows = window.commsConvergence.rows(4); rows[0].count = 1; window.commsConvergence.summary(rows, "hold"); window.commsConvergence.remote(3) })
                    await receiver.waitForTimeout(40)
                    assert.equal((await read(receiver)).row, 4, "Older read must not clear newer unread arrival")
                    if (baseline) await receiver.evaluate(() => window.commsConvergence.invalidate())
                    await receiver.evaluate(() => window.commsConvergence.settle())
                    await until(receiver, () => window.commsConvergence.state.row === 1)
                    reports.push({ engine, viewport, kind, case: "older read preserves newer message", baseline, passed: true })

                    const localAcknowledgementMs = []
                    for (let sample = 0; sample < 3; sample++) {
                        await load(receiver, kind)
                        await receiver.evaluate(() => window.commsConvergence.summary([], "hold"))
                        const priorAck = await read(receiver)
                        await receiver.evaluate(() => window.commsConvergence.acknowledge())
                        await assertCleared(receiver)
                        const acked = await read(receiver)
                        assert.equal(acked.counters.summary - priorAck.counters.summary, 1, "Healthy local acknowledgement keeps one existing summary request")
                        localAcknowledgementMs.push(acked.observations.at(-1))
                    }
                    reports.push({ engine, viewport, kind, case: "healthy local acknowledgement matched observations", baseline, badgeCommitSamplesMs: localAcknowledgementMs, summaryRequestsPerSample: 1, passed: true })

                    await load(receiver, kind)
                    await receiver.locator("#composer").fill("Draft must survive badge reconciliation")
                    await receiver.locator("#pane").hover(); await receiver.mouse.wheel(0, 350)
                    // WebKit may keep applying a wheel animation after wheel() resolves.
                    // Capture its settled position before testing exact preservation.
                    const scroll = await settledScrollPosition(receiver.locator("#pane"))
                    assert.ok(scroll > 0, "Real wheel interaction must scroll fixture")
                    await receiver.evaluate(() => { window.commsConvergence.summary([], "hold"); window.commsConvergence.remote() })
                    if (!baseline) await assertCleared(receiver)
                    assert.equal(await receiver.locator("#composer").inputValue(), "Draft must survive badge reconciliation")
                    assert.equal(await receiver.locator("#pane").evaluate(node => node.scrollTop), scroll)
                    await receiver.locator("#other").click(); await receiver.locator("#chat").click()
                    assert.equal(await receiver.locator("#composer").inputValue(), "Draft must survive badge reconciliation")
                    assert.equal((await read(receiver)).counters.reads, 0, "Receiving a read must not create a local read write")
                    reports.push({ engine, viewport, kind, case: "badge update retains fixture draft and scroll", baseline, passed: true })
                } finally { await Promise.all(contexts.map(context => context.close())) }
            }
        } finally { await browser.close() }
    }
    assert.deepEqual(pageErrors, [])
    console.log(JSON.stringify({ baseline, passed: reports.length, observations: reports.filter(row => "badgeCommitMs" in row).map(({ engine, viewport, kind, case: name, badgeCommitMs, summaryRequests }) => ({ engine, width: viewport.width, kind, case: name, badgeCommitMs, summaryRequests })) }))
} finally {
    server.kill("SIGTERM")
    await mkdir("browser-results", { recursive: true })
    await writeFile(process.env.COMMS_CONVERGENCE_REPORT ?? `browser-results/comms-convergence-${baseline ? "baseline" : "candidate"}.json`, JSON.stringify({ baseline: process.env.COMMS_CONVERGENCE_BASELINE ?? null, observedAt: new Date().toISOString(), reports, pageErrors, limits: "Production React, actual unread hooks and extracted workspace callbacks, synthetic responses and separate browser contexts. Timings end at the React layout commit, not verified screen paint, and are fixture observations; not production latency, authenticated UI or physical-device evidence. Minimal interaction controls do not replace full Comms UI checks." }, null, 2))
}
