import assert from "node:assert/strict"
import test from "node:test"
import { createRequire } from "node:module"
import { readFileSync } from "node:fs"
import ts from "typescript"
import { canAccessWorkspaceUrl } from "../lib/workspace-panels.ts"
import { validateSopFile, SOP_PDF_TYPE, SOP_DOCX_TYPE, MAX_SOP_BYTES, sopCursor } from "../lib/sops/policy.ts"
const require = createRequire(import.meta.url)
function load(file: string, mocks: Record<string, unknown> = {}): Record<string, unknown> {
    const m = { exports: {} }
    const code = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
    new Function("require", "module", "exports", code)((name: string) => name in mocks ? mocks[name] : name === "server-only" ? {} : name === "./policy" ? load("lib/sops/policy.ts") : name === "./ticket" ? load("lib/sops/ticket.ts") : require(name), m, m.exports)
    return m.exports
}
const ticketApi = load("lib/sops/ticket.ts") as typeof import("../lib/sops/ticket")
const document = { name: "Tracking SOP.pdf", size: 1024, type: SOP_PDF_TYPE }
const ticket = { id: "a1111111-1111-4111-8111-111111111111", workspaceId: "workspace-a", userId: "admin-a", file: document, expires: Date.now() + 60_000 }
test("SOP file validation accepts PDF/DOCX and rejects unsupported, empty, oversized or mismatched uploads", () => {
    assert.equal(validateSopFile(document).type, SOP_PDF_TYPE)
    assert.equal(validateSopFile({ name: "Ads.DOCX", size: 100, type: "" }).type, SOP_DOCX_TYPE)
    for (const file of [{ ...document, name: "macro.docm" }, { ...document, type: "text/html" }, { ...document, size: 0 }, { ...document, size: MAX_SOP_BYTES + 1 }, { ...document, name: "../document.pdf" }, null]) assert.throws(() => validateSopFile(file))
})
test("upload receipt cannot be altered, reused by another account/workspace or used after expiry", () => {
    const token = ticketApi.signSopTicket(ticket, "secret")
    assert.deepEqual(ticketApi.readSopTicket(token, "secret", ticket.workspaceId, ticket.userId), ticket)
    assert.throws(() => ticketApi.readSopTicket(token, "different", ticket.workspaceId, ticket.userId))
    assert.throws(() => ticketApi.readSopTicket(token, "secret", "workspace-b", ticket.userId))
    assert.throws(() => ticketApi.readSopTicket(token, "secret", ticket.workspaceId, "admin-b"))
    assert.throws(() => ticketApi.readSopTicket(token, "secret", ticket.workspaceId, ticket.userId, ticket.expires))
    const body = Buffer.from(JSON.stringify({ ...ticket, file: { ...document, size: 1 } })).toString("base64url")
    assert.throws(() => ticketApi.readSopTicket(`${body}.${token.split(".")[1]}`, "secret", ticket.workspaceId, ticket.userId))
})
test("staff without service assignments can access SOPs without gaining Library access", () => {
    assert.equal(canAccessWorkspaceUrl("/acme/sops", "acme", "staff", []), true)
    assert.equal(canAccessWorkspaceUrl(`/acme/sops/${ticket.id}`, "acme", "staff", []), true)
    assert.equal(canAccessWorkspaceUrl("/acme/assets", "acme", "staff", []), false)
    assert.equal(canAccessWorkspaceUrl("/acme/settings", "acme", "staff", []), false)
    assert.equal(canAccessWorkspaceUrl("/other/sops", "acme", "staff", []), false)
})
test("catalogue cursor preserves timestamp precision and rejects query injection", () => {
    const value = `2026-09-13T12:30:01.123456+00:00|${ticket.id}`
    assert.equal(sopCursor(value)?.created_at, "2026-09-13T12:30:01.123456+00:00")
    assert.throws(() => sopCursor(`${value}),id.gt.0`))
    assert.throws(() => sopCursor(`bad|${ticket.id}`))
})
function fixture() {
    let asset: Record<string, unknown> | null = null
    let badSize = false, failInsert = false, badFormat = false, insertCount = 0
    const storage: string[] = [], queries: Array<[string, unknown]> = []
    const db = { from: () => {
        const filters: Record<string, unknown> = {}
        const query = {
            select: () => query,
            eq: (key: string, value: unknown) => { filters[key] = value; return query },
            maybeSingle: async () => ({ data: asset && filters.workspace_id === asset.workspace_id && filters.id === asset.id ? asset : null, error: null }),
            order: (key: string) => { queries.push(["order", key]); return query },
            or: (value: string) => { queries.push(["cursor", value]); return query },
            limit: async (n: number) => { queries.push(["limit", n]); return { data: Array.from({ length: 25 }, (_, i) => ({ id: String(i), created_at: "2026-09-13T00:00:00+00:00" })), error: null } },
            insert: async (value: Record<string, unknown>) => { insertCount++; if (failInsert) return { error: { code: "unavailable" } }; asset = value; return { error: null } },
        }
        return query
    } }
    const client = { send: async (cmd: { constructor: { name: string }; input: Record<string, unknown> }) => {
        const name = cmd.constructor.name; storage.push(name)
        if (name === "HeadObjectCommand") return { ContentLength: badSize ? 2 : document.size, ContentType: document.type, ETag: "original-etag" }
        if (name === "GetObjectCommand") return { Body: { transformToByteArray: async () => Buffer.from(badFormat ? "<html>" : "%PDF-1.7") } }
        if (name === "CopyObjectCommand") assert.equal(cmd.input.CopySourceIfMatch, "original-etag")
        return {}
    } }
    const api = load("lib/sops/server.ts", {
        "@/lib/supabase/admin": { supabaseAdmin: db },
        "@/lib/env": { getRequiredEnv: () => "secret" },
        "@/lib/onboarding/uploads": { getR2Client: () => client, getR2BucketName: () => "bucket" },
        "@/lib/onboarding/r2-cors": { ensurePlatformDirectUploads: async () => undefined },
    }) as typeof import("../lib/sops/server")
    return { api, storage, queries, get asset() { return asset }, get insertCount() { return insertCount }, set badSize(v: boolean) { badSize = v }, set badFormat(v: boolean) { badFormat = v }, set failInsert(v: boolean) { failInsert = v } }
}
test("verified upload becomes one ordinary asset; lost-acknowledgement replay does no storage work", async () => {
    const f = fixture(), receipt = ticketApi.signSopTicket(ticket, "secret")
    assert.equal(await f.api.finishSopUpload(ticket.workspaceId, ticket.userId, receipt), ticket.id)
    assert.equal(f.asset?.native_kind, "sop_document")
    assert.equal(f.asset?.asset_kind, "document")
    assert.match(String(f.asset?.storage_path), /\/sops\/[^/]+\/document.pdf$/)
    const calls = f.storage.length
    assert.equal(await f.api.finishSopUpload(ticket.workspaceId, ticket.userId, receipt), ticket.id)
    assert.equal(f.storage.length, calls)
    assert.equal(f.insertCount, 1)
})
test("incomplete or invalid uploads never become catalogue assets", async () => {
    for (const kind of ["size", "format"]) {
        const f = fixture(); f.badSize = kind === "size"; f.badFormat = kind === "format"
        await assert.rejects(f.api.finishSopUpload(ticket.workspaceId, ticket.userId, ticketApi.signSopTicket(ticket, "secret")))
        assert.equal(f.insertCount, 0)
        assert.equal(f.storage.includes("CopyObjectCommand"), false)
    }
})
test("failed asset persistence retains staging and can recover with the same receipt", async () => {
    const f = fixture(), receipt = ticketApi.signSopTicket(ticket, "secret")
    f.failInsert = true
    await assert.rejects(f.api.finishSopUpload(ticket.workspaceId, ticket.userId, receipt), /Retry saving/)
    assert.equal(f.storage.includes("DeleteObjectCommand"), false)
    f.failInsert = false
    assert.equal(await f.api.finishSopUpload(ticket.workspaceId, ticket.userId, receipt), ticket.id)
})
test("catalogue requests only one page and uses timestamp plus ID for ties", async () => {
    const f = fixture()
    const result = await f.api.listSops(ticket.workspaceId, `2026-09-13T00:00:00.123456+00:00|${ticket.id}`)
    assert.equal(result.items.length, 24)
    assert.ok(result.next)
    assert.deepEqual(f.queries.filter(([kind]) => kind === "order"), [["order", "created_at"], ["order", "id"]])
    assert.deepEqual(f.queries.at(-1), ["limit", 25])
    assert.equal(f.storage.length, 0)
})
test("upload endpoint rejects staff before any upload/storage command, including direct finalize calls", async () => {
    let writes = 0
    const route = load("app/api/workspaces/[workspaceSlug]/sops/upload/route.ts", {
        "@/lib/workspaces": { requireWorkspace: async () => ({ workspace: { id: ticket.workspaceId }, user: { id: "staff" }, role: "staff" }) },
        "@/lib/sops/policy": load("lib/sops/policy.ts"),
        "@/lib/sops/server": { prepareSopUpload: async () => { writes++ }, finishSopUpload: async () => { writes++ } },
    }) as typeof import("../app/api/workspaces/[workspaceSlug]/sops/upload/route")
    for (const action of ["prepare", "finish"]) {
        const response = await route.POST(new Request("https://betelgeze.com/api/workspaces/acme/sops/upload", { method: "POST", body: JSON.stringify({ action, receipt: "anything" }) }), { params: Promise.resolve({ workspaceSlug: "acme" }) })
        assert.equal(response.status, 403)
    }
    assert.equal(writes, 0)
})
test("document endpoint gives no URL for a SOP outside the authenticated workspace", async () => {
    let signatures = 0
    const route = load("app/api/workspaces/[workspaceSlug]/sops/[id]/document/route.ts", {
        "@/lib/workspaces": { requireWorkspace: async () => ({ workspace: { id: "workspace-b" } }) },
        "@/lib/sops/server": { getSop: async (workspace: string) => { assert.equal(workspace, "workspace-b"); return null }, sopDocumentUrl: async () => { signatures++; return "private" } },
    }) as typeof import("../app/api/workspaces/[workspaceSlug]/sops/[id]/document/route")
    const response = await route.GET(new Request("https://betelgeze.com/document"), { params: Promise.resolve({ workspaceSlug: "b", id: ticket.id }) })
    assert.equal(response.status, 404)
    assert.equal(signatures, 0)
})
