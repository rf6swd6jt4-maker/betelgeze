import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import ts from "typescript"

const workspaceId = "00000000-0000-4000-8000-000000000001"
const relationshipId = "00000000-0000-4000-8000-000000000002"
const requestId = "00000000-0000-4000-8000-000000000003"
const phone = "+18178084210"
const address = `whatsapp:${phone}`

type Row = Record<string, unknown>

function compile(path: string) {
    return ts.transpileModule(readFileSync(path, "utf8"), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText
}

function sharedModules(options: {
    access?: boolean; relationship?: Row; consentOk?: boolean; consentStatus?: number; consentError?: string;
    configThrows?: string; duplicate?: boolean; deliveryFailed?: boolean; insertFails?: boolean;
}, templateFnName: "getWhatsAppCallRequestTemplate" | "getWhatsAppReportReadyTemplate", template: Row) {
    const reads: Array<{ table: string; filters: Row }> = []
    const writes: Row[] = []
    const deliveries: Row[] = []
    const relationship = {
        id: relationshipId, workspace_id: workspaceId, client_id: null, status: "active",
        business_name: "Example Home Services", whatsapp_phone: phone, primary_phone: phone,
        whatsapp_opted_out_at: null, ...options.relationship,
    }
    return {
        reads, writes, deliveries,
        modules: {
            "@/lib/communications/workspace-access": { requireCommunicationsWorkspace: async () => ({ workspace: { id: workspaceId }, user: { id: "staff" } }) },
            "@/lib/communications/access": { clientConversationCanWrite: async () => options.access !== false },
            "@/lib/client-messages/whatsapp-engagement-consent": {
                resolveConfirmedWhatsAppAddress: async () => options.consentOk === false
                    ? { ok: false, status: options.consentStatus ?? 409, error: options.consentError ?? "This contact has not confirmed WhatsApp communications. Use the initial consent flow first." }
                    : { ok: true, address },
            },
            "@/lib/workspace-integrations": {
                getWorkspaceProviderConfig: async () => {
                    if (options.configThrows) throw new Error(options.configThrows)
                    return {}
                },
                [templateFnName]: async () => template,
            },
            "@/lib/client-messages/omnichannel": { sendCommunicationDeliveries: async (input: Row) => {
                deliveries.push(input)
                return options.deliveryFailed ? { status: "send_failed", error: "Provider rejected template" } : { status: "sent", error: null }
            } },
            "@/lib/supabase/admin": { supabaseAdmin: {
                from: (table: string) => {
                    const read: typeof reads[number] = { table, filters: {} }; reads.push(read)
                    let inserted = false
                    const query = {
                        select(fields: string) { read.filters.fields = fields; return query },
                        eq(key: string, value: unknown) { read.filters[key] = value; return query },
                        insert(row: Row) { inserted = true; writes.push(row); return query },
                        async single() {
                            assert.ok(inserted)
                            if (options.insertFails) return { error: { message: "write failed" }, data: null }
                            return options.duplicate ? { error: { code: "23505" }, data: null } : { error: null, data: { id: "message" } }
                        },
                        async maybeSingle() {
                            if (table === "relationships") return { error: null, data: relationship }
                            assert.equal(table, "client_messages")
                            return { error: null, data: { id: "previous-message", status: "sent" } }
                        },
                    }
                    return query
                },
            } },
        },
    }
}

function post(code: string, modules: Record<string, unknown>, body: Row) {
    const compiled = { exports: {} as { POST: (request: Request, context: unknown) => Promise<Response> } }
    new Function("require", "module", "exports", code)((name: string) => { assert.ok(name in modules, name); return modules[name] }, compiled, compiled.exports)
    return compiled.exports.POST(new Request("https://fixture/engage", { method: "POST", body: JSON.stringify(body) }), { params: Promise.resolve({ workspaceSlug: "fixture" }) })
}

// --- request-call route ---

const callRoutePath = "app/api/workspaces/[workspaceSlug]/communications/request-call/route.ts"
const callTemplate = { name: "be_service_cooperation_call", language: "en_US", bodyVariableCount: 3 }
const callBody = { relationshipId, clientRequestId: requestId, serviceName: "business phone setup", requirement: "verifying the business phone number" }

test("request-call: sends the call-request template with the three expected variables in order", async () => {
    const code = compile(callRoutePath)
    const f = sharedModules({}, "getWhatsAppCallRequestTemplate", callTemplate)
    const response = await post(code, f.modules, callBody)
    assert.equal(response.status, 200)
    assert.deepEqual(f.deliveries[0].whatsappTemplate, {
        name: "be_service_cooperation_call", language: "en_US",
        components: [{ type: "body", parameters: [
            { type: "text", text: "business phone setup" },
            { type: "text", text: "Example Home Services" },
            { type: "text", text: "verifying the business phone number" },
        ] }],
    })
    assert.equal(f.writes[0].automation_kind, "whatsapp_call_request")
    assert.equal(f.writes[0].client_request_id, requestId)
})

test("request-call: missing/blank fields, bad IDs, and no write access are rejected before any read", async () => {
    const code = compile(callRoutePath)
    for (const body of [
        { ...callBody, relationshipId: "not-a-uuid" },
        { ...callBody, clientRequestId: "not-a-uuid" },
        { ...callBody, serviceName: "   " },
        { ...callBody, requirement: "" },
    ]) {
        const f = sharedModules({}, "getWhatsAppCallRequestTemplate", callTemplate)
        assert.equal((await post(code, f.modules, body)).status, 400)
        assert.deepEqual(f.writes, [])
    }
    const denied = sharedModules({ access: false }, "getWhatsAppCallRequestTemplate", callTemplate)
    assert.equal((await post(code, denied.modules, callBody)).status, 404)
})

test("request-call: archived relationships, opt-outs, and unresolved consent cannot send", async () => {
    const code = compile(callRoutePath)
    for (const [options, status] of [
        [{ relationship: { status: "archived" } }, 404],
        [{ relationship: { whatsapp_opted_out_at: "2026-01-01T00:00:00Z" } }, 409],
        [{ consentOk: false }, 409],
    ] as const) {
        const f = sharedModules(options, "getWhatsAppCallRequestTemplate", callTemplate)
        const response = await post(code, f.modules, callBody)
        assert.equal(response.status, status)
        assert.deepEqual(f.writes, [])
        assert.deepEqual(f.deliveries, [])
    }
})

test("request-call: an unconfigured or reshaped template fails closed without sending", async () => {
    const code = compile(callRoutePath)
    const unconfigured = sharedModules({ configThrows: "Configure and verify a WhatsApp call-request Utility template in Settings before using Request a call." }, "getWhatsAppCallRequestTemplate", callTemplate)
    assert.equal((await post(code, unconfigured.modules, callBody)).status, 409)
    assert.deepEqual(unconfigured.deliveries, [])

    const reshaped = sharedModules({}, "getWhatsAppCallRequestTemplate", { ...callTemplate, bodyVariableCount: 2 })
    const response = await post(code, reshaped.modules, callBody)
    assert.equal(response.status, 409)
    assert.deepEqual(reshaped.deliveries, [])
})

test("request-call: duplicate client_request_id reuses the prior message, and provider rejection is a failure", async () => {
    const code = compile(callRoutePath)
    const duplicate = sharedModules({ duplicate: true }, "getWhatsAppCallRequestTemplate", callTemplate)
    const response = await post(code, duplicate.modules, callBody)
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { messageId: "previous-message", status: "sent", reused: true })
    assert.deepEqual(duplicate.deliveries, [])

    const failed = sharedModules({ deliveryFailed: true }, "getWhatsAppCallRequestTemplate", callTemplate)
    assert.equal((await post(code, failed.modules, callBody)).status, 502)
})

// --- send-report route ---

const reportRoutePath = "app/api/workspaces/[workspaceSlug]/communications/send-report/route.ts"
const reportTemplate = { name: "be_weekly_report_ready", language: "en_US", bodyVariableCount: 2 }
const reportBody = { relationshipId, clientRequestId: requestId, period: "October 26–November 1, 2026" }

test("send-report: sends the report-ready template with business name and period, in order", async () => {
    const code = compile(reportRoutePath)
    const f = sharedModules({}, "getWhatsAppReportReadyTemplate", reportTemplate)
    const response = await post(code, f.modules, reportBody)
    assert.equal(response.status, 200)
    assert.deepEqual(f.deliveries[0].whatsappTemplate, {
        name: "be_weekly_report_ready", language: "en_US",
        components: [{ type: "body", parameters: [
            { type: "text", text: "Example Home Services" },
            { type: "text", text: "October 26–November 1, 2026" },
        ] }],
    })
    assert.equal(f.writes[0].automation_kind, "whatsapp_report_ready")
})

test("send-report: a blank period, archived relationship, opt-out, or unresolved consent cannot send", async () => {
    const code = compile(reportRoutePath)
    const blank = sharedModules({}, "getWhatsAppReportReadyTemplate", reportTemplate)
    assert.equal((await post(code, blank.modules, { ...reportBody, period: "  " })).status, 400)
    for (const [options, status] of [
        [{ relationship: { status: "archived" } }, 404],
        [{ relationship: { whatsapp_opted_out_at: "2026-01-01T00:00:00Z" } }, 409],
        [{ consentOk: false }, 409],
    ] as const) {
        const f = sharedModules(options, "getWhatsAppReportReadyTemplate", reportTemplate)
        assert.equal((await post(code, f.modules, reportBody)).status, status)
        assert.deepEqual(f.deliveries, [])
    }
})

test("send-report: a reshaped template fails closed, and duplicate requests reuse the prior message", async () => {
    const code = compile(reportRoutePath)
    const reshaped = sharedModules({}, "getWhatsAppReportReadyTemplate", { ...reportTemplate, bodyVariableCount: 3 })
    assert.equal((await post(code, reshaped.modules, reportBody)).status, 409)
    assert.deepEqual(reshaped.deliveries, [])

    const duplicate = sharedModules({ duplicate: true }, "getWhatsAppReportReadyTemplate", reportTemplate)
    const response = await post(code, duplicate.modules, reportBody)
    assert.deepEqual(await response.json(), { messageId: "previous-message", status: "sent", reused: true })
})
