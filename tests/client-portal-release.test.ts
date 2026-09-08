import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire, Module } from "node:module"
import { resolve } from "node:path"
import test from "node:test"
import ts from "typescript"

function loadServer(path: string, dependencies: Record<string, unknown> = {}) {
    const source = ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
    const localRequire = createRequire(resolve(path))
    const compiled = new Module(resolve(path)) as Module & { _compile: (source: string, filename: string) => void }
    compiled.require = ((name: string) => name in dependencies ? dependencies[name] : localRequire(name)) as typeof compiled.require
    compiled._compile(source, path)
    return compiled.exports
}
const forms = loadServer("lib/onboarding/forms.ts")
const resources = loadServer("lib/client-portal/resources.ts", { "../onboarding/forms": forms })
const receipts = loadServer("lib/onboarding/upload-receipt.ts")
const appointments = loadServer("lib/client-portal/appointments.ts", { "../appointment-setting": loadServer("lib/appointment-setting.ts") })
const access = { workspace: { id: "workspace" }, relationship: { id: "relationship" }, session: { id: "session" } }
const context = { params: Promise.resolve({ token: "token" }) }
const scope = { workspaceId: "workspace", relationshipId: "relationship", sessionId: "session", stepKey: "client_portal_resources", fieldName: "resources" }
const path = "workspace/client-portal/relationship/session/00000000-0000-4000-8000-000000000001-report.pdf"
function upload() {
    const file = { name: "Report.pdf", size: 1024, type: "application/pdf", path, provider: "r2", kind: "document", receipt: "" }
    file.receipt = receipts.signUploadReceipt(scope, file, "test-key")
    return file
}
type Query = { table: string; operation: string; payload?: any; filters: Array<[string, string, unknown]>; selection?: string }
function database(respond: (query: Query) => unknown) {
    const queries: Query[] = []
    return { queries, from(table: string) {
        const query: Query = { table, operation: "read", filters: [] }
        queries.push(query)
        const builder: any = {
            select(selection: string) { query.selection = selection; return builder },
            insert(payload: unknown) { query.operation = "insert"; query.payload = payload; return builder },
            upsert(payload: unknown) { query.operation = "upsert"; query.payload = payload; return builder },
            eq(key: string, value: unknown) { query.filters.push(["eq", key, value]); return builder },
            gte(key: string, value: unknown) { query.filters.push(["gte", key, value]); return builder },
            lt(key: string, value: unknown) { query.filters.push(["lt", key, value]); return builder },
            order() { return builder }, range() { return builder },
            maybeSingle() { return Promise.resolve(respond(query)) }, single() { return Promise.resolve(respond(query)) },
            then(resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) { return Promise.resolve(respond(query)).then(resolve, reject) },
        }
        return builder
    } }
}
function resourceRoute(db: ReturnType<typeof database>, validAccess = true, inspect = async () => {}) {
    return loadServer("app/api/client-portal/session/[token]/resources/route.ts", {
        "@/lib/client-portal/session": { resolveClientPortalAccessByToken: async () => validAccess ? access : null },
        "@/lib/client-portal/resources": resources,
        "@/lib/env": { getRequiredEnv: () => "test-key" },
        "@/lib/onboarding/r2-cors": { ensurePlatformDirectUploads: async () => {} },
        "@/lib/onboarding/upload-receipt": receipts,
        "@/lib/onboarding/uploads": { inspectOnboardingUpload: inspect },
        "@/lib/supabase/admin": { supabaseAdmin: db },
        "@/lib/client-portal/resource-persistence": loadServer("lib/client-portal/resource-persistence.ts", { "@/lib/supabase/admin": { supabaseAdmin: db } }),
    })
}
const post = (body: unknown) => new Request("https://portal.example/api", { method: "POST", body: JSON.stringify(body) })

test("resource validation accepts arbitrary formats and empty files but rejects forged sizes and paths", () => {
    assert.ok(resources.portalResourceFile({ name: "empty.unknown", size: 0 }))
    assert.ok(resources.portalResourceFile({ name: "x", size: forms.MAX_ONBOARDING_UPLOAD_SIZE + 1 }))
    assert.equal(resources.portalResourceFile({ name: "x", size: resources.MAX_PORTAL_RESOURCE_SIZE + 1 }), null)
    assert.equal(resources.portalResourceFile({ name: "x", size: -1 }), null)
    assert.equal(resources.portalResourceFile({ name: "x", size: 1.5 }), null)
    assert.equal(resources.portalResourceFile({ name: "x\nHeader", size: 1 }).name, "x\nHeader")
    assert.equal(resources.portalResourceFile({ name: "x", size: 1, type: "text/html\r\nX: bad" }).type, "application/octet-stream")
    assert.equal(resources.portalResourceFile({ name: "資料".repeat(200) + ".zip", size: 1 }).name, "資料".repeat(200) + ".zip")
    for (const type of ["image/heic", "application/x-msdownload", "application/x-autocad", "", "unknown type"]) assert.ok(resources.portalResourceFile({ name: "anything", size: 1, type }))
    assert.ok(resources.portalResourceUpload({ ...upload(), path: path.replace("report.pdf", "report..pdf") }, "workspace/client-portal/relationship/session/"))
    assert.equal(resources.portalResourceUpload({ ...upload(), path: "other/client-portal/a" }, "workspace/client-portal/relationship/session/"), null)
    assert.equal(resources.portalResourceUpload({ ...upload(), path: `${path}/../other` }, "workspace/client-portal/relationship/session/"), null)
})

test("portal resource receipts cannot cross relationships, sessions or file metadata", () => {
    const file = upload()
    assert.ok(receipts.validUploadReceipt(scope, file, "test-key"))
    assert.equal(receipts.validUploadReceipt({ ...scope, relationshipId: "other" }, file, "test-key"), false)
    assert.equal(receipts.validUploadReceipt({ ...scope, sessionId: "other" }, file, "test-key"), false)
    assert.equal(receipts.validUploadReceipt(scope, { ...file, size: 999 }, "test-key"), false)
    assert.equal(receipts.validUploadReceipt(scope, { ...file, name: "different.pdf" }, "test-key"), false)
})

test("revoked portal resources deny reads and writes before database or storage access", async () => {
    const db = database(() => { throw new Error("Must not query") })
    const route = resourceRoute(db, false)
    assert.equal((await route.POST(post({ action: "confirm", upload: upload() }), context)).status, 404)
    assert.equal((await route.GET({ nextUrl: new URL("https://portal.example") }, context)).status, 404)
    assert.equal(db.queries.length, 0)
})

test("unconfirmed or forged resource uploads cannot create assets", async () => {
    const db = database(() => { throw new Error("Must not query") })
    const route = resourceRoute(db, true, async () => { throw new Error("Object absent") })
    assert.equal((await route.POST(post({ action: "confirm", upload: { ...upload(), receipt: "forged" } }), context)).status, 400)
    assert.equal((await route.POST(post({ action: "confirm", upload: upload() }), context)).status, 409)
    assert.equal(db.queries.length, 0)
})

test("resource save retries repair a failed relationship link without duplicating the asset", async () => {
    let asset: any = null
    let links = 0
    let inserts = 0
    const db = database((query) => {
        if (query.table === "asset_relationships") {
            assert.deepEqual(query.payload, { workspace_id: "workspace", relationship_id: "relationship", asset_id: "asset" })
            return { error: ++links === 1 ? { message: "temporary failure" } : null }
        }
        if (query.operation === "insert") {
            inserts++
            assert.equal(query.payload.native_key, path)
            asset = { id: "asset", title: "Report.pdf", content_type: "application/pdf", file_size: 1024, created_at: "2026-09-08T12:00:00Z" }
        }
        return { data: asset, error: null }
    })
    const route = resourceRoute(db)
    const first = await route.POST(post({ action: "confirm", upload: upload() }), context)
    assert.equal(first.status, 503)
    const second = await route.POST(post({ action: "confirm", upload: upload() }), context)
    assert.equal(second.status, 201)
    assert.equal(inserts, 1)
    assert.equal(links, 2)
    assert.equal((await second.json()).resource.name, "Report.pdf")
    for (const query of db.queries.filter((item) => item.operation === "read")) {
        assert.ok(query.filters.some((entry) => entry[1] === "workspace_id" && entry[2] === "workspace"))
        assert.ok(query.filters.some((entry) => entry[1] === "native_key" && entry[2] === path))
    }
})

test("resource lists filter both workspace and relationship and do not return storage paths", async () => {
    const db = database(() => ({ data: [{ id: "asset", title: "Report.pdf", content_type: "application/pdf", file_size: 12, created_at: "2026-09-08", storage_path: "private", asset_relationships: [{}] }], error: null }))
    const response = await resourceRoute(db).GET({ nextUrl: new URL("https://portal.example") }, context)
    assert.equal(response.status, 200)
    assert.equal(response.headers.get("cache-control"), "private, no-store")
    const body = await response.json()
    assert.equal(body.resources[0].storage_path, undefined)
    assert.equal(body.resources[0].asset_relationships, undefined)
    for (const key of ["workspace_id", "asset_relationships.workspace_id", "asset_relationships.relationship_id", "native_kind"]) assert.ok(db.queries[0].filters.some((entry) => entry[1] === key))
})

test("appointments hide drafts, staff-only fields, and unsafe meeting links", () => {
    const row = { id: "appt", workflow_status: "submitted", appointment_at: "2026-09-09T16:00:00Z", appointment_timezone: "America/New_York", contact_name: "Lead", meeting_link: "javascript:alert(1)", details: { email: "lead@example.com", internal_secret: "private" }, submitted_by: "staff", submission_message_id: "private" }
    assert.equal(appointments.portalAppointment({ ...row, workflow_status: "draft" }), null)
    const result = appointments.portalAppointment(row)
    assert.equal(result.meetingLink, null)
    assert.equal(result.details.internal_secret, undefined)
    assert.equal(result.submitted_by, undefined)
    assert.equal(result.submission_message_id, undefined)
    assert.equal(appointments.safeMeetingLink("https://meet.google.com/abc-defg-hij"), "https://meet.google.com/abc-defg-hij")
    assert.match(appointments.appointmentDateLabels(result).time, /12:00 PM EDT/)
    assert.equal(appointments.portalAppointment({ ...row, appointment_at: "bad" }), null)
})

test("appointment API enforces relationship scope and submission even when querying past bookings", async () => {
    const db = database(() => ({ data: [], error: null }))
    const route = loadServer("app/api/client-portal/session/[token]/appointments/route.ts", {
        "@/lib/client-portal/appointments": appointments,
        "@/lib/client-portal/session": { resolveClientPortalAccessByToken: async () => access },
        "@/lib/supabase/admin": { supabaseAdmin: db },
    })
    const response = await route.GET({ nextUrl: new URL("https://portal.example?view=past") }, context)
    assert.equal(response.status, 200)
    const constraints = db.queries[0].filters
    assert.ok(constraints.some((entry) => entry[1] === "workspace_id" && entry[2] === "workspace"))
    assert.ok(constraints.some((entry) => entry[1] === "relationship_id" && entry[2] === "relationship"))
    assert.ok(constraints.some((entry) => entry[1] === "workflow_status" && entry[2] === "submitted"))
    assert.ok(constraints.some((entry) => entry[0] === "lt" && entry[1] === "appointment_at"))
})

test("resource downloads deny mismatched relationships and return only short-lived forced-download URLs", async () => {
    let signed = 0
    const db = database(() => ({ data: { title: "Example.html", storage_path: "workspace/client-portal/relationship/session/file" }, error: null }))
    const dependencies = {
        "@/lib/client-portal/session": { resolveClientPortalAccessByToken: async () => access },
        "@/lib/onboarding/uploads": { createPrivateResourceDownloadUrl: async (path: string, name: string) => { signed++; assert.equal(name, "Example.html"); return "https://storage.example/signed-download" } },
        "@/lib/supabase/admin": { supabaseAdmin: db },
    }
    const fileContext = { params: Promise.resolve({ token: "token", resourceId: "00000000-0000-4000-8000-000000000001" }) }
    const route = loadServer("app/api/client-portal/session/[token]/resources/[resourceId]/route.ts", dependencies)
    const response = await route.GET(new Request("https://portal.example"), fileContext)
    assert.equal(response.status, 303)
    assert.equal(response.headers.get("cache-control"), "private, no-store")
    assert.equal(response.headers.get("location"), "https://storage.example/signed-download")
    assert.equal(signed, 1)
    assert.ok(db.queries[0].filters.some((entry) => entry[1] === "asset_relationships.relationship_id" && entry[2] === "relationship"))
    const foreign = database(() => ({ data: { title: "Secret", storage_path: "workspace/client-portal/other/session/file" }, error: null }))
    const otherRoute = loadServer("app/api/client-portal/session/[token]/resources/[resourceId]/route.ts", { ...dependencies, "@/lib/supabase/admin": { supabaseAdmin: foreign } })
    assert.equal((await otherRoute.GET(new Request("https://portal.example"), fileContext)).status, 404)
    assert.equal(signed, 1)
})
