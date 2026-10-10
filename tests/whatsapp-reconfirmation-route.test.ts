import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import ts from "typescript"
import { normalizeProviderAddress } from "../lib/client-messages/addresses.ts"
import { whatsappWindowIsOpen } from "../lib/client-messages/whatsapp-window.ts"

const workspaceId = "00000000-0000-4000-8000-000000000001"
const relationshipId = "00000000-0000-4000-8000-000000000002"
const requestId = "00000000-0000-4000-8000-000000000003"
const phone = "+18178084210"
const confirmedAt = "2026-09-21T22:53:55.762002+00:00"
const code = ts.transpileModule(readFileSync("app/api/workspaces/[workspaceSlug]/communications/reconfirm/route.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText

type Row = Record<string, unknown>
function fixture(options: {
    access?: boolean; relationship?: Row; choice?: Row; sales?: Row[];
    saleError?: boolean; choicesError?: boolean; templateVerified?: boolean;
    duplicate?: boolean; deliveryFailed?: boolean;
} = {}) {
    const reads: Array<{ table: string; fields?: string; filters: Row; limit?: number; order?: string }> = []
    const writes: Row[] = [], deliveries: Row[] = []
    const relationship = {
        id: relationshipId, workspace_id: workspaceId, client_id: null, status: "active",
        whatsapp_phone: phone, primary_phone: phone,
        last_whatsapp_inbound_at: new Date(Date.now() - 48 * 3600_000).toISOString(),
        whatsapp_opted_out_at: null, ...options.relationship,
    }
    const sales = options.sales ?? [{
        workspace_id: workspaceId, relationship_id: relationshipId,
        consent_confirmed_at: confirmedAt, consent_confirmed_message_id: null,
        confirmation_source: "relationship_channels",
        delivery_choices: [{ provider: "meta_whatsapp", address: phone }],
    }]
    const modules: Record<string, unknown> = {
        "@/lib/communications/workspace-access": { requireCommunicationsWorkspace: async () => ({ workspace: { id: workspaceId }, user: { id: "staff" } }) },
        "@/lib/communications/access": { clientConversationCanAccess: async () => options.access !== false },
        "@/lib/client-messages/addresses": { normalizeProviderAddress },
        "@/lib/client-messages/whatsapp-window": { whatsappWindowIsOpen },
        "@/lib/workspace-integrations": { getWorkspaceProviderConfig: async () => ({
            reconfirmation_template_name: "service_reconfirmation", reconfirmation_template_language: "en",
            reconfirmation_template_validation: options.templateVerified !== false,
        }) },
        "@/lib/client-messages/omnichannel": { sendCommunicationDeliveries: async (input: Row) => {
            deliveries.push(input)
            return options.deliveryFailed ? { status: "send_failed", error: "Provider rejected template" } : { status: "sent", error: null }
        } },
        "@/lib/supabase/admin": { supabaseAdmin: {
            rpc: async (name: string, args: Row) => {
                assert.equal(name, "relationship_messaging_choices")
                assert.deepEqual(args, { p_workspace_id: workspaceId, p_relationship_id: relationshipId })
                return { error: options.choicesError ? {} : null, data: [{ provider: "meta_whatsapp", address: phone, confirmedAt: null, confirmationStatus: null, ...options.choice }] }
            },
            from: (table: string) => {
                const read: typeof reads[number] = { table, filters: {} }; reads.push(read)
                let inserted = false
                const query = {
                    select(fields: string) { read.fields = fields; return query },
                    eq(key: string, value: unknown) { read.filters[key] = value; return query },
                    not(key: string, operator: string, value: unknown) {
                        assert.deepEqual([key, operator, value], ["consent_confirmed_at", "is", null])
                        read.filters.confirmed = true; return query
                    },
                    order(key: string, order: { ascending: boolean }) { assert.equal(order.ascending, false); read.order = key; return query },
                    limit(value: number) { read.limit = value; return query },
                    insert(row: Row) { inserted = true; writes.push(row); return query },
                    async single() { assert.ok(inserted); return options.duplicate ? { error: { code: "23505" }, data: null } : { error: null, data: { id: "message" } } },
                    async maybeSingle() {
                        if (table === "relationships") return { error: null, data: relationship }
                        if (table === "client_messages") return { error: null, data: { id: "previous-message", status: "sent" } }
                        assert.equal(table, "client_sales")
                        let rows = sales.filter(row => Object.entries(read.filters).every(([key, value]) => key === "confirmed" ? row.consent_confirmed_at != null : row[key] === value))
                        if (read.order) rows = rows.sort((a, b) => String(b[read.order!]).localeCompare(String(a[read.order!])))
                        if (read.limit) rows = rows.slice(0, read.limit)
                        assert.ok(rows.length <= 1)
                        return { error: options.saleError ? {} : null, data: rows[0] ?? null }
                    },
                }
                return query
            },
        } },
    }
    const compiled = { exports: {} as { POST: (request: Request, context: unknown) => Promise<Response> } }
    new Function("require", "module", "exports", code)((name: string) => { assert.ok(name in modules, name); return modules[name] }, compiled, compiled.exports)
    return { reads, writes, deliveries, sales, post: () => compiled.exports.POST(new Request("https://fixture/reconfirm", {
        method: "POST", body: JSON.stringify({ relationshipId, clientRequestId: requestId }),
    }), { params: Promise.resolve({ workspaceSlug: "fixture" }) }) }
}

test("expired-window reconfirmation sends the configured template using channel-selected sale confirmation without a reply ID", async () => {
    const f = fixture()
    assert.equal((await f.post()).status, 200)
    assert.deepEqual(f.deliveries[0].whatsappTemplate, { name: "service_reconfirmation", language: "en" })
    assert.deepEqual(f.deliveries[0].destinations, [{ provider: "meta_whatsapp", address: `whatsapp:${phone}`, channelId: null, primary: true }])
    assert.equal(f.writes[0].automation_kind, "whatsapp_reconfirmation")
    assert.equal(f.writes[0].client_request_id, requestId)
    assert.equal(f.writes.length, 1)
    assert.deepEqual(f.reads.find(read => read.table === "client_sales"), {
        table: "client_sales", fields: "consent_confirmed_at, raw_payload->confirmation_source, raw_payload->delivery_choices",
        filters: { workspace_id: workspaceId, relationship_id: relationshipId, confirmed: true },
        order: "consent_confirmed_at", limit: 1,
    })
})

test("already-confirmed contacts retain the existing request path without a sale lookup", async () => {
    const f = fixture({ choice: { confirmedAt } })
    assert.equal((await f.post()).status, 200)
    assert.equal(f.reads.some(read => read.table === "client_sales"), false)
})

test("sale fallback cannot authorize another channel, number, relationship, workspace, or unconfirmed sale", async () => {
    const sale = fixture().sales[0]
    for (const override of [
        { delivery_choices: [{ provider: "twilio_sms", address: phone }] },
        { delivery_choices: [{ provider: "meta_whatsapp", address: "+15551234567" }] },
        { delivery_choices: null }, { delivery_choices: [null] },
        { confirmation_source: "unknown" }, { consent_confirmed_at: null },
        { workspace_id: "other" }, { relationship_id: "other" },
    ]) {
        const f = fixture({ sales: [{ ...sale, ...override }] })
        assert.equal((await f.post()).status, 409, JSON.stringify(override))
        assert.deepEqual(f.writes, [])
        assert.deepEqual(f.deliveries, [])
    }
})

test("only the latest confirmed sale is inspected and missing evidence fails closed", async () => {
    const sale = fixture().sales[0]
    for (const sales of [[], [sale, { ...sale, consent_confirmed_at: "2026-09-22T00:00:00Z", delivery_choices: [{ provider: "twilio_sms", address: phone }] }]]) {
        const f = fixture({ sales })
        assert.equal((await f.post()).status, 409)
        assert.deepEqual(f.deliveries, [])
    }
})

test("opt-out, revoked confirmation, changed address, open window and access denial cannot send", async () => {
    for (const [options, status] of [
        [{ relationship: { whatsapp_opted_out_at: confirmedAt } }, 409],
        [{ choice: { confirmationStatus: "revoked" } }, 409],
        [{ choice: { address: "+15551234567" } }, 409],
        [{ relationship: { last_whatsapp_inbound_at: new Date().toISOString() } }, 409],
        [{ relationship: { status: "archived" } }, 404],
        [{ access: false }, 404],
    ] as const) {
        const f = fixture(options)
        assert.equal((await f.post()).status, status)
        assert.equal(f.reads.some(read => read.table === "client_sales"), false)
        assert.deepEqual(f.writes, [])
        assert.deepEqual(f.deliveries, [])
    }
})

test("lookup failures and unverified templates never send", async () => {
    for (const [options, status] of [[{ choicesError: true }, 503], [{ saleError: true }, 503], [{ templateVerified: false }, 409]] as const) {
        const f = fixture(options)
        assert.equal((await f.post()).status, status)
        assert.deepEqual(f.writes, [])
        assert.deepEqual(f.deliveries, [])
    }
})

test("existing accepted reconfirmations are reused, while provider rejection remains a failure", async () => {
    const duplicate = fixture({ duplicate: true })
    const response = await duplicate.post()
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { messageId: "previous-message", status: "sent", reused: true })
    assert.deepEqual(duplicate.deliveries, [])
    const failed = fixture({ deliveryFailed: true })
    assert.equal((await failed.post()).status, 502)
})
