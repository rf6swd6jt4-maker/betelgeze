import assert from "node:assert/strict"
import test from "node:test"
import { readFileSync } from "node:fs"
import ts from "typescript"
import * as crypto from "node:crypto"

type Values = Record<string, unknown>
const workspace = "10000000-0000-4000-8000-000000000001"
const user = "10000000-0000-4000-8000-000000000002"
const assetId = "10000000-0000-4000-8000-000000000003"
const version = "2026-10-01T12:00:00.000Z"
const asset = { id: assetId, workspace_id: workspace, title: "Private image", source_kind: "upload", native_kind: "manual_upload", storage_path: `${workspace}/assets/${user}/${assetId}/original`, external_url: null }
function load(path: string, mocks: Values): Values {
    const exports = {}
    const code = ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
    new Function("require", "exports", code)((name: string) => {
        assert.ok(name in mocks, `Unexpected dependency ${name}`)
        return mocks[name]
    }, exports)
    return exports
}

test("asset previews sign only same-workspace private objects and keep message/SOP authorization endpoints", async () => {
    const signed: string[] = []
    const loaded = load("lib/assets/preview.ts", {
        "server-only": {}, "@/lib/onboarding/uploads": { createPrivateUploadSignedUrl: async (path: string) => { signed.push(path); return "private-signed" } },
    })
    const preview = loaded.assetPreviewUrl as (w: string, slug: string, value: Values, thumbnail?: boolean) => Promise<string | null>
    assert.equal(await preview(workspace, "alpha", asset), "private-signed")
    assert.deepEqual(signed, [asset.storage_path])
    for (const value of [
        { ...asset, workspace_id: "foreign" }, { ...asset, storage_path: `foreign/${assetId}` },
        { ...asset, storage_path: `${workspace}/../foreign` }, { ...asset, storage_path: `${workspace}//foreign` },
        { ...asset, storage_path: null, external_url: "javascript:alert(1)" },
        { ...asset, storage_path: null, external_url: "data:text/html,private" },
    ]) assert.equal(await preview(workspace, "alpha", value), null)
    assert.equal(await preview(workspace, "alpha", { ...asset, source_kind: "message" }), `/api/client-messages/media/${asset.storage_path}`)
    assert.equal(await preview(workspace, "alpha", { ...asset, native_kind: "sop_extracted_image" }, true), `/api/workspaces/alpha/sop-images/${assetId}?thumbnail=1`)
    assert.equal(await preview(workspace, "alpha", { ...asset, storage_path: null, external_url: "https://example.test/file" }), "https://example.test/file")
    assert.equal(signed.length, 1, "denied, external, and separately authorized media never receive storage credentials")
})

function actionHarness(role: string, options: { updated?: Values | null; latest?: Values | null; error?: boolean } = {}) {
    const calls: Array<{ kind: string; value: unknown }> = []
    let updating = false
    const query = {
        update(value: unknown) { updating = true; calls.push({ kind: "update", value }); return this },
        select(value: unknown) { calls.push({ kind: "select", value }); return this },
        eq(key: string, value: unknown) { calls.push({ kind: key, value }); return this },
        async maybeSingle() { return { data: updating ? (updating = false, options.updated ?? null) : options.latest ?? null, error: options.error ? { message: "private" } : null } },
    }
    const loaded = load("app/[workspaceSlug]/assets/[id]/actions.ts", {
        "next/cache": { revalidatePath: (value: string) => calls.push({ kind: "revalidate", value }) },
        "@/lib/relationships": { assetHref: () => "/alpha/assets/asset", workspaceHref: () => "/alpha/assets" },
        "@/lib/workspace-access": { requireWorkspaceAccess: async () => ({ workspace: { id: workspace }, user: { id: user }, role, access: { capabilities: ["fulfilment.manage", "onboarding.manage", "library.manage"] } }) },
        "@/lib/supabase/server": { createSupabaseServerClient: async () => ({ from: (value: string) => { calls.push({ kind: "from", value }); return query } }) },
    })
    const save = (extra = {}) => (loaded.updateAssetFields as (slug: string, id: string, input: Values) => Promise<Values>)("alpha", assetId, { expectedUserId: user, expectedUpdatedAt: version, title: "Changed", description: "Description", ...extra })
    return { calls, save }
}

test("readable assets and forged capability arrays do not grant staff metadata editing", async () => {
    const fixture = actionHarness("staff")
    assert.equal((await fixture.save()).ok, false)
    assert.deepEqual(fixture.calls, [])
})

test("owner/admin saves retain actor and optimistic version checks using the session database client", async () => {
    for (const role of ["owner", "admin"]) {
        const fixture = actionHarness(role, { updated: { title: "Changed", description: "Description", updated_at: version } })
        assert.equal((await fixture.save()).ok, true)
        for (const [kind, value] of [["workspace_id", workspace], ["id", assetId], ["updated_at", version]]) assert.ok(fixture.calls.some(call => call.kind === kind && call.value === value))
        assert.equal(fixture.calls.filter(call => call.kind === "from").length, 1)
        const switched = actionHarness(role)
        assert.equal((await switched.save({ expectedUserId: "another-account" })).ok, false)
        assert.deepEqual(switched.calls, [])
    }
})

test("revoked or failed update never reports success or exposes conflict fields without an authorized read", async () => {
    for (const options of [{}, { error: true }]) {
        const fixture = actionHarness("admin", options)
        const result = await fixture.save()
        assert.equal(result.ok, false)
        assert.equal(result.values, undefined)
        assert.ok(!fixture.calls.some(call => call.kind === "revalidate"))
        assert.ok(!JSON.stringify(result).includes("private"))
    }
    const conflict = await actionHarness("owner", { latest: { title: "Concurrent", description: "Accepted", updated_at: version } }).save()
    assert.deepEqual(conflict.values, { title: "Concurrent", description: "Accepted" })
})

test("private resource download uses actor-bound asset read on every request and refuses foreign storage", async () => {
    let current: Values | null = { ...asset, native_kind: "client_portal_resource", storage_path: `${workspace}/client-portal/file` }
    let signed = 0, reads = 0
    const session = {}
    const download = load("lib/assets/download.ts", {})
    const response = load("lib/assets/download-response.ts", {
        "server-only": {}, "./download": download,
        "@/lib/onboarding/uploads": { createPrivateResourceDownloadUrl: async () => { signed++; return "https://storage.test/private" } },
    })
    const loaded = load("app/api/workspaces/[workspaceSlug]/assets/[assetId]/download/route.ts", {
        "@/lib/assets/download-response": response,
        "@/lib/workspace-access": { requireWorkspaceAccess: async () => ({ workspace: { id: workspace }, access: {} }), workspaceAccessHasCapability: () => true },
        "@/lib/supabase/server": { createSupabaseServerClient: async () => session },
        "@/lib/relationships": { getAsset: async (w: string, id: string, reader: unknown) => { assert.equal(w, workspace); assert.equal(id, assetId); assert.equal(reader, session); reads++; return current } },
        "@/lib/onboarding/uploads": { createPrivateResourceDownloadUrl: async () => { signed++; return "https://storage.test/private" } },
    })
    const get = () => (loaded.GET as (request: Request, context: unknown) => Promise<Response>)(new Request("https://example.test/download"), { params: Promise.resolve({ workspaceSlug: "alpha", assetId }) })
    assert.equal((await get()).status, 303)
    current = null
    const revoked = await get()
    assert.equal(revoked.status, 404)
    assert.equal(revoked.headers.get("cache-control"), "private, no-store")
    current = { ...asset, native_kind: "client_portal_resource", storage_path: "foreign/client-portal/file" }
    assert.equal((await get()).status, 404)
    assert.equal(signed, 1)
    assert.equal(reads, 3)
})

test("attachment paging reads through session RLS without per-row authorization or signing denied records", async () => {
    const calls: Array<{ table: string; kind: string; value: unknown }> = []
    const previews: string[] = []
    const tableRows: Record<string, Values[]> = {
        asset_work_items: [{ asset_id: assetId, created_at: version }], note_work_items: [],
        assets: [{ ...asset, content_type: "image/png", asset_kind: "media" }], notes: [],
    }
    const client = { from(table: string) {
        let boundedTargets = false
        const query = {
            select(value: unknown) { calls.push({ table, kind: "select", value }); return this },
            eq(key: string, value: unknown) { calls.push({ table, kind: key, value }); return this },
            order() { return this }, limit(value: number) { calls.push({ table, kind: "limit", value }); return this }, in(key: string, value: unknown) { boundedTargets = true; calls.push({ table, kind: key, value }); return this },
            then(resolve: (value: unknown) => void) { resolve({ data: boundedTargets && table === "asset_work_items" ? tableRows.assets.map(asset => ({ assets: asset })) : tableRows[table] ?? [], error: null }) },
        }; return query
    } }
    const pages = load("lib/attachment-pages.ts", {})
    const loaded = load("lib/record-attachments.ts", {
        "server-only": {}, "@/lib/supabase/server": { createSupabaseServerClient: async () => client }, "@/lib/supabase/admin": { supabaseAdmin: client }, "@/lib/attachment-pages": pages,
        "@/lib/assets/attachment-cursor": { decodePrivateAttachmentCursor: pages.decodeAttachmentCursor, encodePrivateAttachmentCursor: pages.encodeAttachmentCursor },
        "@/lib/assets/preview": { assetPreviewUrl: async (w: string, slug: string, value: Values) => { assert.equal(w, workspace); assert.equal(slug, "alpha"); previews.push(value.id as string); return "private-preview" } },
    })
    const list = () => (loaded.listRecordAttachments as (w: string, owner: string, id: string, options: unknown) => Promise<{ items: Values[] }>)(workspace, "work-item", "work", { workspaceSlug: "alpha" })
    assert.deepEqual((await list()).items.map(item => item.id), [assetId])
    assert.equal(calls.filter(call => call.kind === "select").length, 3, "two bounded link reads and one batched asset read")
    assert.ok(calls.filter(call => call.kind === "limit").every(call => call.value === Number(pages.ATTACHMENT_PAGE_SIZE) + 1))
    assert.ok(calls.filter(call => call.kind === "workspace_id").every(call => call.value === workspace))
    assert.deepEqual(calls.find(call => call.kind === "asset_id")?.value, [assetId], "record/link authorization checks only the fixed source candidates")
    tableRows.asset_work_items = []
    assert.deepEqual((await list()).items, [], "revoked links disappear in a fresh read")
    assert.deepEqual(previews, [assetId])
})


test("private attachment cursors hide denied candidate IDs and reject tampering or a different parent", () => {
    const pages = load("lib/attachment-pages.ts", {})
    const loaded = load("lib/assets/attachment-cursor.ts", { "server-only": {}, "node:crypto": crypto, "@/lib/env": { getRequiredEnv: () => "fixture-secret" }, "@/lib/attachment-pages": pages })
    const encode = loaded.encodePrivateAttachmentCursor as (value: unknown, scope: string) => string | null
    const decode = loaded.decodePrivateAttachmentCursor as (value: unknown, scope: string) => unknown
    const value = { asset: { id: assetId, at: version }, note: null }, scope = `${workspace}:work-item:parent`
    const encoded = encode(value, scope)!
    assert.deepEqual(decode(encoded, scope), value)
    assert.ok(!encoded.includes(assetId))
    assert.ok(!Buffer.from(encoded.slice("private1.".length), "base64url").toString().includes(assetId))
    assert.throws(() => decode(encoded, scope + "different"))
    assert.throws(() => decode(encoded.slice(0, 20) + "?" + encoded.slice(21), scope))
    assert.equal(encode({ asset: null, note: null }, scope), null)
    assert.deepEqual(decode((pages.encodeAttachmentCursor as (value: unknown) => string)(value), scope), value, "already-open legacy page positions remain accepted and cannot grant record access")
})


test("native and legacy work details leave attachment loading to the bounded shared owner", async () => {
    const rendered: Array<{ type: string; props: Values }> = []
    const metrics: unknown[] = []
    const item = { id: assetId, title: "Assigned work", visibility: "workspace", area: "delivery", status: "todo", updated_at: version }
    const forbidPrefetch = () => { throw new Error("Work detail must not enumerate or sign attachment history") }
    const jsx = (type: string, props: Values) => { const value = { type, props }; rendered.push(value); return value }
    const common: Values = {
        "server-only": {}, "react/jsx-runtime": { jsx, jsxs: jsx },
        "next/navigation": { notFound: () => { throw new Error("Not found") } },
        "@/lib/relationships": {
            getWorkItem: async () => item, listWorkItemRelationships: async () => [], listWorkItemAssets: forbidPrefetch,
            getWorkItemPlanningContext: async () => ({ members: [], creator: null, assignees: [], dependencies: [], parent: null }),
        },
        "@/lib/workspace-access": {
            requireWorkspaceAccess: async () => ({ workspace: { id: workspace, slug: "alpha" }, user: { id: user }, role: "staff", access: {} }),
            workspaceAccessHasCapability: () => true, accessibleRelationshipIds: async () => new Set(), accessibleWorkItemIds: async () => new Set([assetId]),
        },
        "@/lib/supabase/server": { createSupabaseServerClient: forbidPrefetch },
        "@/lib/supabase/admin": { supabaseAdmin: { from: forbidPrefetch } },
        "@/lib/onboarding/uploads": { createUploadSignedUrls: async (paths: string[]) => { assert.deepEqual(paths, []); return new Map() } },
        "@/lib/assets/preview": { assetPreviewUrl: forbidPrefetch },
        "@/lib/assets/download": { assetDownloadHref: forbidPrefetch },
        "@/lib/admin/okrs": {}, "@/lib/profile-avatar": {},
        "@/lib/ui/relative-time": { shortId: () => "REF", formatRelativeTime: () => "Now" },
        "@/components/list/work-item-presentation": { workItemStatusPresentation: () => ({ label: "To do", tone: "neutral" }) },
        "@/components/workspace/ClientContextPanel": { loadRelationshipContext: async (input: Values) => { metrics.push(input.metrics); return {} }, ClientContextPanel: "ClientContextPanel" },
        "@/components/workspace/WorkspaceTopBar": { WorkspaceTopBar: "WorkspaceTopBar" },
        "@/components/detail": { DetailDangerAction: "DetailDangerAction", DetailDangerButton: "DetailDangerButton", DetailDangerZone: "DetailDangerZone", DetailPageHeader: "DetailPageHeader" },
        "@/components/ui": { SquarePill: "SquarePill" }, "@/components/detail/RecordAttachments": { RecordAttachments: "RecordAttachments" },
        "./InlineWorkItemFields": { InlineWorkItemFields: "InlineWorkItemFields" },
    }
    const native = load("lib/workspace-native-library.ts", common)
    const snapshot = await (native.loadNativeLibrary as (slug: string, kind: string, id: string) => Promise<Values>)("alpha", "work-items", assetId)
    assert.equal(snapshot.kind, "work-item-detail")
    assert.equal("assets" in snapshot, false, "no unused unbounded attachment payload")
    assert.deepEqual(metrics, [[{ label: "Status", value: "To do" }]])
    const legacy = load("app/[workspaceSlug]/work-items/[id]/page.tsx", common)
    await (legacy.default as (props: unknown) => Promise<unknown>)({ params: Promise.resolve({ workspaceSlug: "alpha", id: assetId }) })
    assert.equal(rendered.filter(node => node.type === "RecordAttachments").length, 1)
    const owner = rendered.find(node => node.type === "RecordAttachments")!.props
    assert.equal(owner.ownerId, assetId)
    assert.equal(owner.owner, "work-item")
    assert.equal(owner.initialAssets, undefined)
    assert.deepEqual(rendered.find(node => node.type === "ClientContextPanel")!.props.metrics, [{ label: "Status", value: "To do" }])
})
