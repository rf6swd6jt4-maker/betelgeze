import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import ts from "typescript"
import { normalizeProviderAddress } from "../lib/client-messages/addresses.ts"

const workspaceId = "00000000-0000-4000-8000-000000000001"
const relationshipId = "00000000-0000-4000-8000-000000000002"
const phone = "+18178084210"
const confirmedAt = "2026-09-21T22:53:55.762002+00:00"
const code = ts.transpileModule(readFileSync("lib/client-messages/whatsapp-engagement-consent.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText

type Row = Record<string, unknown>
function fixture(options: { choice?: Row; sales?: Row[]; saleError?: boolean; choicesError?: boolean } = {}) {
    const reads: Array<{ table: string; filters: Row; limit?: number; order?: string }> = []
    const sales = options.sales ?? [{
        workspace_id: workspaceId, relationship_id: relationshipId,
        consent_confirmed_at: confirmedAt, confirmation_source: "relationship_channels",
        delivery_choices: [{ provider: "meta_whatsapp", address: phone }],
    }]
    const modules: Record<string, unknown> = {
        "@/lib/client-messages/addresses": { normalizeProviderAddress },
        "@/lib/supabase/admin": { supabaseAdmin: {
            rpc: async (name: string, args: Row) => {
                assert.equal(name, "relationship_messaging_choices")
                assert.deepEqual(args, { p_workspace_id: workspaceId, p_relationship_id: relationshipId })
                return { error: options.choicesError ? {} : null, data: [{ provider: "meta_whatsapp", address: phone, confirmedAt: null, confirmationStatus: null, ...options.choice }] }
            },
            from: (table: string) => {
                assert.equal(table, "client_sales")
                const read: typeof reads[number] = { table, filters: {} }; reads.push(read)
                const query = {
                    select(fields: string) { read.filters.fields = fields; return query },
                    eq(key: string, value: unknown) { read.filters[key] = value; return query },
                    not(key: string, operator: string, value: unknown) {
                        assert.deepEqual([key, operator, value], ["consent_confirmed_at", "is", null])
                        read.filters.confirmed = true; return query
                    },
                    order(key: string, order: { ascending: boolean }) { assert.equal(order.ascending, false); read.order = key; return query },
                    limit(value: number) { read.limit = value; return query },
                    async maybeSingle() {
                        let rows = sales.filter(row => Object.entries(read.filters).every(([key, value]) => key === "fields" ? true : key === "confirmed" ? row.consent_confirmed_at != null : row[key] === value))
                        if (read.order) rows = rows.sort((a, b) => String(b[read.order!]).localeCompare(String(a[read.order!])))
                        if (read.limit) rows = rows.slice(0, read.limit)
                        return { error: options.saleError ? {} : null, data: rows[0] ?? null }
                    },
                }
                return query
            },
        } },
    }
    const compiled = { exports: {} as { resolveConfirmedWhatsAppAddress: (workspaceId: string, relationshipId: string, relationship: Row) => Promise<unknown> } }
    new Function("require", "module", "exports", code)((name: string) => { assert.ok(name in modules, name); return modules[name] }, compiled, compiled.exports)
    return { reads, sales, resolve: (relationship: Row = { whatsapp_phone: phone, primary_phone: phone }) => compiled.exports.resolveConfirmedWhatsAppAddress(workspaceId, relationshipId, relationship) }
}

test("no WhatsApp number fails closed without a consent lookup", async () => {
    const f = fixture()
    const result = await f.resolve({ whatsapp_phone: null, primary_phone: null })
    assert.deepEqual(result, { ok: false, status: 409, error: "This client has no WhatsApp number." })
})

test("a reply-confirmed address is approved without a sale lookup", async () => {
    const f = fixture({ choice: { confirmedAt } })
    assert.deepEqual(await f.resolve(), { ok: true, address: `whatsapp:${phone}` })
    assert.equal(f.reads.length, 0)
})

test("channel-selected sale confirmation substitutes for a missing reply ID", async () => {
    const f = fixture()
    assert.deepEqual(await f.resolve(), { ok: true, address: `whatsapp:${phone}` })
    assert.equal(f.reads.length, 1)
})

test("sale fallback cannot authorize another channel, number, or an unconfirmed sale", async () => {
    const sale = fixture().sales[0]
    for (const override of [
        { delivery_choices: [{ provider: "twilio_sms", address: phone }] },
        { delivery_choices: [{ provider: "meta_whatsapp", address: "+15551234567" }] },
        { confirmation_source: "unknown" },
        { consent_confirmed_at: null },
    ]) {
        const f = fixture({ sales: [{ ...sale, ...override }] })
        assert.deepEqual(await f.resolve(), { ok: false, status: 409, error: "This contact has not confirmed WhatsApp communications. Use the initial consent flow first." })
    }
})

test("revoked confirmation or a changed address cannot send", async () => {
    for (const choice of [{ confirmationStatus: "revoked" }, { address: "+15551234567" }]) {
        const f = fixture({ choice })
        assert.deepEqual(await f.resolve(), { ok: false, status: 409, error: "This contact has not confirmed WhatsApp communications. Use the initial consent flow first." })
    }
})

test("lookup failures fail closed with a retryable error", async () => {
    assert.deepEqual(await fixture({ choicesError: true }).resolve(), { ok: false, status: 503, error: "Could not verify WhatsApp consent." })
    assert.deepEqual(await fixture({ saleError: true }).resolve(), { ok: false, status: 503, error: "Could not verify WhatsApp consent." })
})
