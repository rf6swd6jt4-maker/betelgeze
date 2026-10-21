import assert from "node:assert/strict"
import test from "node:test"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, resolve } from "node:path"
import ts from "typescript"

const require = createRequire(import.meta.url), cache = new Map<string, unknown>()
function load(file: string): Record<string, unknown> {
    const filename = resolve(file)
    if (cache.has(filename)) return cache.get(filename) as Record<string, unknown>
    const compiled = { exports: {} }
    const code = ts.transpileModule(readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
    new Function("require", "module", "exports", code)((id: string) => id.startsWith(".") ? load(resolve(dirname(filename), `${id}.ts`)) : require(id), compiled, compiled.exports)
    cache.set(filename, compiled.exports); return compiled.exports
}
const { fetchAppointmentNotePage, processAppointmentNoteEnrichment } = load("lib/ghl-appointments/notes.ts") as typeof import("../lib/ghl-appointments/notes")
const profile = { locationId: "location123", calendarId: "calendar123", calendarName: "Visits", includeNotes: true, privateToken: "synthetic-notes-private-token" }
const note = { id: "note123", body: "Internal note\n" + "A".repeat(64000), userId: "staff123", dateAdded: "2026-10-01T10:00:00Z" }
function fixture(response: unknown = { notes: [note], hasMore: false }) {
    const calls: string[] = []
    const fetcher: typeof fetch = async (input, options) => {
        const url = new URL(String(input)); calls.push(url.pathname + url.search)
        assert.equal(url.origin, "https://services.leadconnectorhq.com")
        assert.equal(options?.cache, "no-store"); assert.equal(options?.redirect, "error")
        return url.pathname.startsWith("/locations/") ? Response.json({ location: { id: profile.locationId } }) : response instanceof Response ? response : Response.json(response)
    }
    return { calls, fetcher }
}
test("staff-only note retrieval preserves full bodies using one bounded page after verified location", async () => {
    const f = fixture(), result = await fetchAppointmentNotePage(profile, "appointment123", 0, f.fetcher)
    assert.equal(result.notes[0].body, note.body)
    assert.equal(result.notes[0].createdAt, "2026-10-01T10:00:00.000Z")
    assert.equal(result.nextOffset, 1); assert.equal(result.hasMore, false)
    assert.deepEqual(f.calls, ["/locations/location123", "/calendars/appointments/appointment123/notes?limit=5&offset=0"])
})
test("disabled notes and invalid offsets never issue a provider request", async () => {
    const f = fixture()
    for (const offset of [-1, 1, 1000, Infinity]) await assert.rejects(fetchAppointmentNotePage(profile, "appointment123", offset, f.fetcher))
    await assert.rejects(fetchAppointmentNotePage({ ...profile, includeNotes: false }, "appointment123", 0, f.fetcher))
    assert.deepEqual(f.calls, [])
})
test("partial pages, foreign identities and oversized notes fail instead of declaring completeness", async () => {
    for (const value of [
        { notes: [note], hasMore: true }, { notes: [note, note], hasMore: false },
        { notes: [{ ...note, body: "x".repeat(65001) }], hasMore: false },
        { notes: [{ ...note, appointmentId: "other" }], hasMore: false },
        { notes: [{ ...note, locationId: "other" }], hasMore: false },
        { notes: [], hasMore: "false" },
    ]) await assert.rejects(fetchAppointmentNotePage(profile, "appointment123", 0, fixture(value).fetcher))
    await assert.rejects(fetchAppointmentNotePage(profile, "appointment123", 0, fixture(new Response("denied", { status: 403 })).fetcher))
    const next = await fetchAppointmentNotePage(profile, "appointment123", 5, fixture({ notes: Array.from({ length: 5 }, (_, n) => ({ ...note, id: `note${n}` })), hasMore: true }).fetcher)
    assert.equal(next.nextOffset, 10)
})
test("notes worker claims one page and never enters event acceptance or notification dispatch", async () => {
    const calls: { p_action: string; p_input: Record<string, unknown> }[] = []
    const job = { profileId: "profile", appointmentId: "appointment123", connectionRevision: "revision", leaseToken: "lease", offset: 0, profile }
    const rpc = async (params: typeof calls[number]) => { calls.push(params); return { data: params.p_action === "claim" ? { job } : { applied: true }, error: null } }
    assert.equal(await processAppointmentNoteEnrichment({ rpc, fetchNotes: async () => ({ notes: [], hasMore: false, nextOffset: 0 }) }), "applied")
    assert.deepEqual(calls.map(call => call.p_action), ["claim", "finish"])
    assert.equal(calls[1].p_input.connectionRevision, "revision")
    calls.length = 0
    assert.equal(await processAppointmentNoteEnrichment({ rpc, fetchNotes: async () => { throw new Error("private provider detail") } }), "attention")
    assert.deepEqual(calls.map(call => call.p_action), ["claim", "fail"])
    assert.equal(JSON.stringify(calls).includes("private provider detail"), false)
})
