import { spawn } from "node:child_process"
import { mkdir, writeFile } from "node:fs/promises"
import assert from "node:assert/strict"
import { chromium, webkit } from "playwright"

const engines = process.argv.slice(2)
if (engines.some(engine => !["chromium", "webkit"].includes(engine))) throw Error("Use chromium and/or webkit")
const output = process.env.RELATIONSHIP_QUEUE_OUTPUT ?? "browser-results/relationship-queue-refresh"
const observations = []
const server = spawn(process.execPath, ["scripts/serve-relationship-queue-refresh-fixture.mjs"], { stdio: ["ignore", "pipe", "pipe"] })
await mkdir(output, { recursive: true })
const payload = (title, offset = 0) => ({
    hasMore: offset === 0,
    // Even a previously obtained pending report must not schedule automatic reads.
    generation: [{ instance_id: "pending-instance", sop_id: "sop", run_id: null, status: "pending", error_summary: null }],
    items: Array.from({ length: 30 }, (_, index) => ({ id: `work-${offset + index}`, title: `${title} ${index + 1}`, status: "todo", queue_state: "Ready",
        workflow_action: null, due_date: null, planned_start_date: null, updated_at: "2026-10-05T12:00:00Z", created_at: "2026-10-05T12:00:00Z",
        assignees: [], services: ["Ads"], automated: false, creator: null })),
})
try {
    const origin = await new Promise((resolve, reject) => {
        let log = ""
        const timer = setTimeout(() => reject(Error(`Queue fixture timeout: ${log}`)), 60_000)
        const read = chunk => { log = (log + chunk).slice(-12000); const match = log.match(/http:\/\/127\.0\.0\.1:\d+\//); if (match) { clearTimeout(timer); resolve(match[0]) } }
        server.stdout.on("data", read); server.stderr.on("data", read)
        server.once("error", error => { clearTimeout(timer); reject(error) })
        server.once("exit", code => { clearTimeout(timer); reject(Error(`Fixture exited ${code}: ${log}`)) })
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
                    await page.clock.install()
                    await page.goto(origin)
                    const readCount = () => page.evaluate(() => window.relationshipQueueFixture.requests.length)
                    const waitReads = count => page.waitForFunction(n => window.relationshipQueueFixture.requests.length === n, count)
                    const respond = async (index, title, offset = 0, status = 200) => {
                        await page.evaluate(({ index, status, data }) => window.relationshipQueueFixture.respond(index, status, data), { index, status, data: payload(title, offset) })
                    }
                    const list = page.getByRole("list", { name: "Relationship work queue", exact: true })
                    const refresh = () => page.getByRole("button", { name: "Refresh queue", exact: true }).click()
                    const ready = async title => { await page.getByRole("link", { name: `${title} 1`, exact: true }).waitFor(); await page.getByRole("button", { name: "Refresh queue", exact: true }).waitFor() }
                    const fixture = operation => page.evaluate(operation)
                    await waitReads(1)
                    assert.equal(await page.getByRole("button", { name: "Refresh queue", exact: true }).isEnabled(), false)
                    await respond(0, "Initial")
                    await ready("Initial")
                    assert.equal(await readCount(), 1, "Initial queue load keeps one request")
                    await page.getByRole("textbox", { name: "Unrelated draft" }).fill("Keep this draft")
                    await list.evaluate(node => { node.scrollTop = 400; window.originalQueueList = node })
                    const scrollBefore = await list.evaluate(node => node.scrollTop)
                    assert.ok(scrollBefore > 0)
                    // Same-turn repeated clicks must coalesce into the existing read owner.
                    await page.getByRole("button", { name: "Refresh queue", exact: true }).evaluate(button => { button.click(); button.click() })
                    await waitReads(2)
                    assert.equal(await page.getByRole("button", { name: "Refreshing…", exact: true }).isEnabled(), false)
                    assert.equal(await list.evaluate(node => node === window.originalQueueList), true)
                    assert.equal(await list.evaluate(node => node.scrollTop), scrollBefore)
                    await respond(1, "Updated")
                    await ready("Updated")
                    assert.equal(await list.evaluate(node => node === window.originalQueueList), true)
                    assert.equal(await list.evaluate(node => node.scrollTop), scrollBefore)
                    assert.equal(await page.getByRole("textbox", { name: "Unrelated draft" }).inputValue(), "Keep this draft")

                    await refresh(); await waitReads(3); await respond(2, "Failure", 0, 503)
                    await page.getByRole("alert").waitFor()
                    assert.equal(await page.getByRole("link", { name: "Updated 1", exact: true }).count(), 1)
                    await page.getByRole("button", { name: "Retry", exact: true }).click(); await waitReads(4); await respond(3, "Recovered")
                    await ready("Recovered"); assert.equal(await page.getByRole("alert").count(), 0)
                    await refresh(); await waitReads(5); await fixture(() => window.relationshipQueueFixture.reject(4))
                    await page.getByRole("alert").waitFor()
                    assert.equal(await page.getByRole("link", { name: "Recovered 1", exact: true }).count(), 1)
                    await page.getByRole("button", { name: "Retry", exact: true }).click(); await waitReads(6); await respond(5, "Online")
                    await ready("Online")

                    await page.getByRole("button", { name: "Next", exact: true }).click(); await waitReads(7); await respond(6, "Second page", 30)
                    await ready("Second page")
                    await refresh(); await waitReads(8)
                    assert.equal(await fixture(() => new URL(window.relationshipQueueFixture.requests[7].url, location.href).searchParams.get("offset")), "30")
                    assert.equal(await page.getByText("Page 2", { exact: true }).count(), 1)
                    await respond(7, "Second refreshed", 30); await ready("Second refreshed")
                    await refresh(); await waitReads(9)
                    await page.getByRole("button", { name: "Previous", exact: true }).click(); await waitReads(10)
                    assert.equal(await fixture(() => window.relationshipQueueFixture.requests[8].signal.aborted), true)
                    await respond(9, "Current first"); await ready("Current first")
                    await respond(8, "Late stale second", 30)
                    assert.equal(await page.getByRole("link", { name: "Late stale second 1", exact: true }).count(), 0)
                    assert.equal(await page.getByText("Page 1", { exact: true }).count(), 1)

                    let count = 10
                    for (const status of [401, 403, 404, 409]) {
                        await refresh(); await waitReads(++count); await respond(count - 1, "Denied", 0, status)
                        await page.getByRole("alert").waitFor()
                        assert.equal(await list.count(), 0, `${status} clears private rows`)
                        assert.equal(await page.getByText("Loading work queue…", { exact: true }).count(), 0, "Access failure does not show permanent loading")
                        await page.getByRole("button", { name: "Retry", exact: true }).click(); await waitReads(++count); await respond(count - 1, `Access restored ${status}`)
                        await ready(`Access restored ${status}`)
                    }
                    await refresh(); await waitReads(++count)
                    const oldAccountRead = count - 1
                    await fixture(() => window.relationshipQueueFixture.account("account-b")); await waitReads(++count)
                    assert.equal(await list.count(), 0)
                    assert.equal(await fixture(() => window.relationshipQueueFixture.requests.at(-1).user), "account-b")
                    await respond(count - 1, "New account"); await ready("New account")
                    await respond(oldAccountRead, "Old account late")
                    assert.equal(await page.getByRole("link", { name: "Old account late 1", exact: true }).count(), 0)

                    await refresh(); await waitReads(++count)
                    const oldDestinationRead = count - 1
                    await fixture(() => window.relationshipQueueFixture.destination("relationship-b")); await waitReads(++count)
                    assert.equal(await list.count(), 0)
                    await respond(count - 1, "New relationship"); await ready("New relationship")
                    await respond(oldDestinationRead, "Old relationship late")
                    assert.equal(await page.getByRole("link", { name: "Old relationship late 1", exact: true }).count(), 0)

                    await refresh(); await waitReads(++count)
                    const inactiveRead = count - 1
                    await fixture(() => window.relationshipQueueFixture.active(false))
                    await page.waitForFunction(index => window.relationshipQueueFixture.requests[index].signal.aborted, inactiveRead)
                    await respond(inactiveRead, "Inactive late")
                    assert.equal(await page.getByRole("link", { name: "Inactive late 1", exact: true }).count(), 0)
                    await fixture(() => window.relationshipQueueFixture.active(true)); await waitReads(++count)
                    await respond(count - 1, "Active again"); await ready("Active again")
                    await page.clock.runFor(40_000)
                    assert.equal(await readCount(), count, "No polling after a read, including a pending generation report")
                    assert.equal(await page.getByRole("textbox", { name: "Unrelated draft" }).inputValue(), "Keep this draft")
                    const options = await fixture(() => window.relationshipQueueFixture.requests.map(request => request.options))
                    assert.ok(options.every(value => value.cache === "no-store" && value.credentials === "same-origin" && value.redirect === "error"))
                    assert.deepEqual(errors, [])
                    assert.deepEqual(external, [])
                    await page.screenshot({ path: `${output}/${engine}-${viewport.width}.png`, animations: "disabled" })
                    observations.push({ engine, viewport, requestCount: count, passed: ["one initial read", "duplicate clicks", "retained rows/scroll/draft", "transient failure and offline recovery", "current-page refresh", "late page response", "401/403/404/409 clearing", "account fencing", "destination fencing", "inactive cancellation", "no polling", "no navigation or external I/O"] })
                    console.log(`PASS ${engine} ${viewport.width}: queue refresh lifecycle; ${count} controlled reads`)
                } finally { await context.close() }
            }
        } finally { await browser.close() }
    }
} finally {
    server.kill("SIGTERM")
    await writeFile(`${output}.json`, JSON.stringify({ observations, limits: "Actual production React queue/read owner and shared List with controlled synthetic fetch responses. Browser emulation, not authenticated app, production latency or physical-device evidence." }, null, 2))
}
