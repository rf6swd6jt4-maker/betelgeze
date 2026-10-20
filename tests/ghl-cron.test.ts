import assert from "node:assert/strict"
import test from "node:test"
import { readFileSync } from "node:fs"
import { timingSafeEqual } from "node:crypto"
import ts from "typescript"

for (const kind of ["appointments", "oauth"] as const) {
    test(`GHL ${kind} cron authenticates before accepting deferred work and respects the deployment gate`, async () => {
        const pending: Array<() => Promise<void>> = []
        let calls = 0
        const mocks: Record<string, unknown> = {
            "node:crypto": { timingSafeEqual },
            "next/server": { after: (callback: () => Promise<void>) => pending.push(callback) },
            "@/lib/ghl-appointments/worker": { processGhlAppointmentAutomation: async () => { calls++; return { failed: 0, attention: 0 } } },
            "@/lib/ghl-appointments/app-events": { drainGhlAppEvents: async () => {} },
            "@/lib/ghl-oauth/server": { renewGhlConnections: async () => { calls++; return { attention: 0 } } },
        }
        const compiled = { exports: {} }
        const code = ts.transpileModule(readFileSync(`app/api/cron/ghl-${kind}/route.ts`, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
        new Function("require", "module", "exports", code)((name: string) => { assert.ok(name in mocks); return mocks[name] }, compiled, compiled.exports)
        const { POST } = compiled.exports as { POST: (request: Request) => Promise<Response> }
        const flag = kind === "oauth" ? "GHL_OAUTH_ENABLED" : "GHL_APPOINTMENT_DETECTION_ENABLED"
        const old = { flag: process.env[flag], primary: process.env.SOP_WORK_CRON_SECRET, legacy: process.env.CRON_SECRET }
        const request = (token: string) => new Request("http://127.0.0.1/fixture", { method: "POST", headers: { authorization: `Bearer ${token}` } })
        try {
            process.env.SOP_WORK_CRON_SECRET = "synthetic-primary"; process.env.CRON_SECRET = "synthetic-legacy"; process.env[flag] = "true"
            assert.equal((await POST(request("synthetic-legacy"))).status, 401)
            assert.equal(pending.length, 0)
            process.env[flag] = "false"
            assert.deepEqual(await (await POST(request("synthetic-primary"))).json(), { disabled: true })
            assert.equal(pending.length, 0)
            process.env[flag] = "true"
            const response = await POST(request("synthetic-primary"))
            assert.equal(response.status, 202); assert.equal(response.headers.get("cache-control"), "no-store")
            assert.equal(calls, 0); assert.equal(pending.length, 1)
            await pending[0](); assert.equal(calls, 1)
        } finally {
            for (const [key, value] of [[flag, old.flag], ["SOP_WORK_CRON_SECRET", old.primary], ["CRON_SECRET", old.legacy]]) {
                if (value === undefined) delete process.env[key!]; else process.env[key!] = value
            }
        }
    })
}
