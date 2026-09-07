import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import ts from "typescript"

const source = readFileSync(new URL("../lib/client-sales/automation.ts", import.meta.url), "utf8")
const functionSource = source.slice(source.indexOf("export async function sendSaleConsentTemplate"), source.indexOf("export async function handleCompletedStripeCheckout"))
const compiled = ts.transpileModule(functionSource.replace("export async", "async"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText

async function runSend(finalized: boolean, advanced: boolean, delivered = true) {
    const databaseTimestamp = "2026-09-07T03:33:00.123456+00:00"
    const responses = [
        { data: { id: "sale", workspace_id: "workspace", relationship_id: "relationship", status: "sale_confirmation_pending", updated_at: "2026-09-07T03:32:00Z" } },
        { data: { id: "sale", updated_at: databaseTimestamp } },
        { data: { id: "message" } },
        { data: { id: "sale" } },
        ...(delivered ? [{ data: { id: "message" } }, { data: finalized ? { id: "sale" } : null }, ...(!finalized ? [{ data: { status: advanced ? "onboarding_link_sent" : "sold_confirmation_sending" } }] : [])] : [{ data: null }]),
    ]
    const filters: unknown[][] = []
    const reports: unknown[][] = []
    const db = { from() {
        const response = responses.shift()
        assert.ok(response, "Unexpected database operation")
        const chain: Record<string, unknown> = {}
        for (const key of ["select", "update", "insert", "eq", "is", "in"]) chain[key] = (...args: unknown[]) => { if (key === "eq") filters.push(args); return chain }
        chain.single = chain.maybeSingle = async () => response
        chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve(response).then(resolve)
        return chain
    } }
    const bindings = {
        supabaseAdmin: db,
        getSaleFlow: () => "onboarding_payment_gate",
        getConsentStatus: (_flow: string, status: "sending" | "awaiting" | "failed") => ({ sending: "sold_confirmation_sending", awaiting: "sold_awaiting_whatsapp_confirm", failed: "sold_confirmation_failed" })[status],
        CONSENT_TEMPLATE_TERMINAL_STATUSES: new Set(["onboarding_link_sent"]),
        CONSENT_TEMPLATE_CLAIM_TIMEOUT_MS: 900000,
        resolveCommunicationDestinations: async () => ({ destinations: [{ provider: "meta_whatsapp", channelId: "channel", primary: true }] }),
        getWorkspaceProviderConfig: async () => ({ consent_template_name: "confirmation" }),
        sendCommunicationDeliveries: async () => ({ results: [{ ok: delivered, provider: "meta_whatsapp", providerMessageId: "accepted-id", primary: true }], error: delivered ? null : "Provider rejected" }),
        reportSaleAutomationFailure: async (...args: unknown[]) => { reports.push(args) },
        recordAdminActivity: async () => true,
    }
    const send = new Function(...Object.keys(bindings), `${compiled}; return sendSaleConsentTemplate`)(...Object.values(bindings))
    const result = await send("sale", "workspace")
    assert.equal(responses.length, 0)
    assert.ok(filters.some(([key, value]) => key === "updated_at" && value === databaseTimestamp), "Verify ownership using the returned database timestamp")
    return { result, reports }
}

test("confirmation accepted while a reply advances onboarding remains successful", async () => {
    const { result, reports } = await runSend(false, true)
    assert.equal(result.ok, true)
    assert.equal(result.reconciled, true)
    assert.equal(reports.length, 0)
})
test("accepted delivery is not reported as failed when bookkeeping needs recovery", async () => {
    const { result, reports } = await runSend(false, false)
    assert.equal(result.ok, true)
    assert.equal(result.synchronizationPending, true)
    assert.equal(reports.length, 1)
})
test("normal acceptance records a successful confirmation", async () => {
    assert.equal((await runSend(true, false)).result.ok, true)
})
test("provider rejection still reports a send failure", async () => {
    const { result } = await runSend(false, false, false)
    assert.equal(result.ok, false)
    assert.equal(result.error, "Provider rejected")
})

test("an accepted provider receipt survives a failed aggregate message update", async () => {
    const senderSource = readFileSync(new URL("../lib/client-messages/omnichannel.ts", import.meta.url), "utf8")
    const senderFunction = senderSource.slice(senderSource.indexOf("export async function sendCommunicationDeliveries"))
    const senderCode = ts.transpileModule(senderFunction.replace("export async", "async"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText
    const responses = [
        { data: { id: "delivery", status: "sent", provider_message_id: "accepted-id" }, error: null },
        { data: null, error: { message: "Summary update failed" } },
    ]
    const db = { from() {
        const response = responses.shift()
        assert.ok(response)
        const chain: Record<string, unknown> = {}
        for (const key of ["select", "update", "eq"]) chain[key] = () => chain
        chain.maybeSingle = async () => response
        chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve(response).then(resolve)
        return chain
    } }
    const send = new Function("supabaseAdmin", "console", `${senderCode}; return sendCommunicationDeliveries`)(db, { error() {} })
    const result = await send({ workspaceId: "workspace", relationshipId: "relationship", messageId: "message", body: "Confirmation", destinations: [{ provider: "meta_whatsapp", primary: true }] })
    assert.equal(result.status, "sent")
    assert.equal(result.results[0].ok, true)
    assert.equal(result.results[0].providerMessageId, "accepted-id")
    assert.equal(result.persistenceError, "Summary update failed")
    assert.equal(responses.length, 0)
})
