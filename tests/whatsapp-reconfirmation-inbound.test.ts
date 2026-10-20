import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import ts from "typescript"

// Execute the production confirmation handler with isolated persistence and
// delivery dependencies. No provider or production database is contacted.
const source = ts.createSourceFile("automation.ts", readFileSync("lib/client-sales/automation.ts", "utf8"), ts.ScriptTarget.Latest, true)
const functions = source.statements.filter(ts.isFunctionDeclaration)
const handlerSource = functions.filter(node => ["handleSaleConsentConfirmation", "recordReturningWhatsAppConfirmation"].includes(node.name?.text ?? "")).map(node => node.getText(source)).join("\n")
const code = ts.transpileModule(handlerSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText

type Row = Record<string, unknown>
function fixture(options: { selected?: boolean; status?: string; writeError?: boolean; recoveryError?: boolean; provider?: string } = {}) {
    const rows: Row[] = [], attempts: Row[] = [], events: string[] = []
    const sale = { id: "sale", workspace_id: "workspace", relationship_id: "relationship", client_id: "client", service_scope: options.selected === false ? "relationship" : "selected_services", consent_confirmed_at: "2026-09-21T10:00:00Z", onboarding_session_id: "session", status: options.status ?? "paid", raw_payload: { flow: "onboarding_payment_gate" } }
    const supabaseAdmin = {
        rpc: async (name: string) => { assert.equal(name, "confirm_relationship_contact"); return { data: { handled: false }, error: null } },
        from: (table: string) => {
            assert.equal(table, "client_messages")
            return { upsert: async (row: Row, config: { onConflict: string; ignoreDuplicates: boolean }) => {
                assert.deepEqual(config, { onConflict: "provider,provider_message_id", ignoreDuplicates: true })
                events.push("persist"); attempts.push(row)
                if (options.writeError) return { error: { message: "Synthetic persistence failure" } }
                if (!rows.some(existing => existing.provider === row.provider && existing.provider_message_id === row.provider_message_id)) rows.push(row)
                return { error: null }
            } }
        },
    }
    const compiled = { exports: {} as { handleSaleConsentConfirmation: (input: Row) => Promise<unknown> } }
    const dependencies = {
        supabaseAdmin,
        isConsentConfirmationText: (text: string) => text.trim().toUpperCase() === "CONFIRM",
        findPendingConfirmedSale: async () => sale,
        getSaleFlow: () => "onboarding_payment_gate",
        retrySelectedServiceOnboardingLink: async (workspaceId: string, relationshipId: string, saleId: string) => {
            assert.deepEqual([workspaceId, relationshipId, saleId], ["workspace", "relationship", "sale"])
            events.push("existing-onboarding-recovery")
            if (options.recoveryError) throw Error("Synthetic recovery failure")
            return { ok: true }
        },
        smsConsentForConfirmation: async () => ({}),
    }
    new Function("exports", ...Object.keys(dependencies), code)(compiled.exports, ...Object.values(dependencies))
    const input = { workspaceId: "workspace", fromAddress: "whatsapp:+15555550123", provider: options.provider ?? "meta_whatsapp", messageId: "synthetic-provider-reply", body: "Confirm", rawPayload: { entry: [{ changes: [{ value: { messages: [{ id: "synthetic-provider-reply", timestamp: "1792421907", text: { body: "Confirm" } }] } }] }] } }
    return { rows, attempts, events, input, run: (overrides: Row = {}) => compiled.exports.handleSaleConsentConfirmation({ ...input, ...overrides }) }
}

test("returning selected-service CONFIRM is saved before existing onboarding recovery", async () => {
    const f = fixture()
    assert.deepEqual(await f.run(), { handled: true, ok: true })
    assert.deepEqual(f.events, ["persist", "existing-onboarding-recovery"])
    assert.equal(f.rows.length, 1)
    assert.deepEqual(f.rows[0], {
        workspace_id: "workspace", relationship_id: "relationship", client_id: "client",
        direction: "inbound", provider: "meta_whatsapp", provider_message_id: f.input.messageId,
        whatsapp_message_id: f.input.messageId, from_address: f.input.fromAddress,
        body: "Confirm", status: "whatsapp_consent_confirmed", sender_kind: "client", raw_payload: f.input.rawPayload,
    })
})

for (const status of ["paid", "onboarding_payment_pending", "onboarding_link_sent"]) {
    test(`returning ${status} relationship reply remains visible when onboarding is skipped`, async () => {
        const f = fixture({ selected: false, status })
        assert.deepEqual(await f.run(), { handled: true, ok: true, skipped: true })
        assert.equal(f.rows.length, 1)
        assert.deepEqual(f.events, ["persist"])
    })
}

test("repeated provider webhook keeps one reply and never overwrites existing history", async () => {
    const f = fixture()
    await f.run()
    await f.run({ body: "CONFIRM", rawPayload: { replay: true } })
    assert.equal(f.rows.length, 1)
    assert.equal(f.rows[0].body, "Confirm")
    assert.deepEqual(f.rows[0].raw_payload, f.input.rawPayload)
    await f.run({ messageId: "another-provider-reply" })
    assert.equal(f.rows.length, 2)
})

test("persistence failure cannot be reported as a handled confirmation", async () => {
    const f = fixture({ writeError: true })
    await assert.rejects(f.run(), /confirmation.*save|save.*confirmation/i)
    assert.equal(f.rows.length, 0)
    assert.deepEqual(f.events, ["persist"])
})

test("a later onboarding recovery failure cannot discard the received reply", async () => {
    const f = fixture({ recoveryError: true })
    await assert.rejects(f.run(), /Synthetic recovery failure/)
    assert.equal(f.rows.length, 1)
})

test("ordinary messages continue through the normal inbound handler", async () => {
    const f = fixture()
    assert.deepEqual(await f.run({ body: "Hello" }), { handled: false })
    assert.equal(f.attempts.length, 0)
    assert.equal(f.events.length, 0)
})

test("the repair does not change SMS confirmation handling", async () => {
    const f = fixture({ provider: "twilio_sms" })
    assert.deepEqual(await f.run(), { handled: true, ok: true })
    assert.equal(f.attempts.length, 0)
    assert.deepEqual(f.events, ["existing-onboarding-recovery"])
})

test("the actual WhatsApp webhook preserves a returning reply and skips its provider replay", async () => {
    const f = fixture()
    const webhookSource = ts.createSourceFile("route.ts", readFileSync("app/api/client-messages/meta/whatsapp/route.ts", "utf8"), ts.ScriptTarget.Latest, true)
    const inbound = webhookSource.statements.filter(ts.isFunctionDeclaration).find(node => node.name?.text === "handleInboundMessage")!
    const inboundCode = ts.transpileModule(`${inbound.getText(webhookSource)}\nexports.receive = handleInboundMessage`, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
    let windowUpdates = 0
    const dependencies = {
        normalizeMessageAddress: (value: string) => value,
        handleInboundReaction: async () => false,
        resolveInboundDestination: async () => ({ clientId: null, relationshipId: "relationship", channel: null }),
        getInboundText: (message: { text: { body: string } }) => message.text.body,
        handleSaleConsentConfirmation: f.run,
        supabaseAdmin: {
            from: (table: string) => {
                assert.equal(table, "client_messages")
                const filters: Row = {}
                const query = {
                    select: () => query,
                    eq: (key: string, value: unknown) => { filters[key] = value; return query },
                    maybeSingle: async () => ({ data: f.rows.find(row => Object.entries(filters).every(([key, value]) => row[key] === value)) ?? null }),
                }
                return query
            },
            rpc: async (name: string, args: Row) => {
                assert.equal(name, "record_relationship_whatsapp_inbound")
                assert.equal(args.p_relationship_id, "relationship")
                assert.equal(args.p_body, "Confirm")
                windowUpdates++
                return { error: null }
            },
        },
    }
    const compiled = { receive: undefined as unknown as (input: Row) => Promise<void> }
    new Function("exports", ...Object.keys(dependencies), inboundCode)(compiled, ...Object.values(dependencies))
    const message = { id: f.input.messageId, from: "15555550123", timestamp: "1792421907", type: "text", text: { body: "Confirm" } }
    const input = { workspaceId: "workspace", message, value: {}, payload: f.input.rawPayload, appBaseUrl: "https://fixture.invalid" }
    await compiled.receive(input)
    await compiled.receive(input)
    assert.equal(f.rows.length, 1)
    assert.equal(windowUpdates, 1)
    assert.deepEqual(f.events, ["persist", "existing-onboarding-recovery"])
})
