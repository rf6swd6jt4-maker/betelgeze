import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import ts from "typescript"
import { getEquivalentMessageAddresses } from "../lib/client-messages/addresses.ts"

const source = ts.createSourceFile("route.ts", readFileSync(process.env.WA_ROUTING_SOURCE ?? "app/api/client-messages/meta/whatsapp/route.ts", "utf8"), ts.ScriptTarget.Latest, true)
const resolver = source.statements.filter(ts.isFunctionDeclaration).find(node => node.name?.text === "resolveInboundDestination")!
const code = ts.transpileModule(resolver.getText(source), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
const sender = "whatsapp:+18175550123"
function fixture(candidates: { id: string; client_id: string | null }[], options: { error?: boolean; channel?: boolean } = {}) {
    const calls: unknown[] = []
    const api = {
        rpc: async (name: string, args: unknown) => {
            calls.push({ name, args }); return { data: candidates, error: options.error ? { message: "unavailable" } : null }
        },
        from: (table: string) => {
            calls.push(table)
            const query = {
                select: () => query, eq: () => query, neq: () => query, in: () => query, is: () => query,
                // Legacy exact lookup misses a persisted formatted number.
                then: (resolve: (value: unknown) => unknown) => resolve({ data: [], error: null }),
                maybeSingle: async () => ({ data: options.channel && table === "client_communication_channels" ? { id: "channel", client_id: "client", external_address: sender } : null, error: null }),
            }
            return query
        },
    }
    const run = new Function("supabaseAdmin", "getEquivalentMessageAddresses", "repairChannelAddress", code + ";return resolveInboundDestination;")(api, getEquivalentMessageAddresses, async (channel: unknown) => channel)
    return { run: () => run(sender, "workspace"), calls }
}

test("formatted relationship phone routes through one workspace-scoped normalized lookup", async () => {
    const f = fixture([{ id: "relationship", client_id: null }])
    assert.deepEqual(await f.run(), { channel: null, clientId: null, relationshipId: "relationship" })
    assert.deepEqual(f.calls, [{ name: "find_whatsapp_inbound_relationships", args: { p_workspace_id: "workspace", p_from_address: sender } }])
})

test("two normalized relationship candidates remain unmatched without channel fallback", async () => {
    const f = fixture([{ id: "one", client_id: null }, { id: "two", client_id: null }], { channel: true })
    assert.deepEqual(await f.run(), { ambiguous: true, channel: null, clientId: null, relationshipId: null })
    assert.equal(f.calls.length, 1)
})

test("normalized lookup failure reaches the existing error owner instead of becoming unmatched", async () => {
    const f = fixture([], { error: true })
    await assert.rejects(f.run(), /look up relationship.*unavailable/)
})

test("legacy channel routing remains available when no relationship matches", async () => {
    const f = fixture([], { channel: true })
    assert.deepEqual(await f.run(), { channel: { id: "channel", client_id: "client", external_address: sender }, clientId: "client", relationshipId: null })
})

test("relationship client channels retain their existing repair owner", async () => {
    const f = fixture([{ id: "relationship", client_id: "client" }], { channel: true })
    assert.deepEqual(await f.run(), { channel: { id: "channel", client_id: "client", external_address: sender }, clientId: "client", relationshipId: "relationship" })
})

for (const body of ["Hello", "CONFIRM"]) test(`ambiguous ${body} is retained unmatched without consent or window side effects`, async () => {
    const node = source.statements.filter(ts.isFunctionDeclaration).find(node => node.name?.text === "handleInboundMessage")!
    const handlerCode = ts.transpileModule(node.getText(source), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
    const rows: Record<string, unknown>[] = []
    const dependencies = {
        normalizeMessageAddress: (value: string) => value,
        handleInboundReaction: async () => false,
        resolveInboundDestination: fixture([{ id: "one", client_id: null }, { id: "two", client_id: null }]).run,
        getInboundText: (message: { text: { body: string } }) => message.text.body,
        handleSaleConsentConfirmation: () => { throw new Error("Ambiguous sender must not confirm a sale") },
        supabaseAdmin: {
            rpc: () => { throw new Error("Ambiguous sender must not update a reply window") },
            from: (table: string) => {
                assert.equal(table, "client_messages")
                const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: null }),
                    insert: async (row: Record<string, unknown>) => { rows.push(row); return { error: null } } }
                return query
            },
        },
    }
    const receive = new Function(...Object.keys(dependencies), handlerCode + ";return handleInboundMessage;")(...Object.values(dependencies))
    const payload = { original: true }
    await receive({ workspaceId: "workspace", message: { id: "provider-id", from: "18175550123", type: "text", text: { body } }, value: {}, payload, appBaseUrl: "https://fixture.invalid" })
    assert.equal(rows.length, 1)
    assert.equal(rows[0].status, "unmatched")
    assert.equal(rows[0].body, body)
    assert.equal(rows[0].relationship_id, undefined)
    assert.equal(rows[0].raw_payload, payload)
})
