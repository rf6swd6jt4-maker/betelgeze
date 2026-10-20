import assert from "node:assert/strict"
import test from "node:test"
import { readFileSync } from "node:fs"
import ts from "typescript"
function fixture(wabaId = "1928719317836909") {
    const calls: Array<{ url: string; options: RequestInit }> = []
    const compiled = { exports: {} }
    const code = ts.transpileModule(readFileSync("lib/client-messages/meta-whatsapp.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
    new Function("require", "module", "exports", "fetch", code)((path: string) => {
        if (path === "@/lib/workspace-integrations") return { getWorkspaceProviderConfig: async () => ({ access_token: "synthetic", phone_number_id: "phone123", waba_id: wabaId }) }
        if (path.includes("env")) return { getRequiredEnv: () => "synthetic" }
        if (path.includes("address")) return { toMetaWhatsAppRecipient: (value: string) => value.replace(/\D/g, "") }
        if (path.includes("error")) return { formatMetaWhatsAppApiError: () => "Provider rejected" }
        throw new Error(`Unstubbed dependency ${path}`)
    }, compiled, compiled.exports, async (url: string, options: RequestInit) => { calls.push({ url, options }); return Response.json({ messages: [{ id: "wamid.fixture" }] }) })
    return { sender: (compiled.exports as typeof import('../lib/client-messages/meta-whatsapp')).sendMetaWhatsAppTemplate, calls }
}
const input = { workspaceId: "workspace", to: "+12025550123", templateName: "be_appointment_added", languageCode: "en_US", expectedWabaId: "1928719317836909", callbackData: "message-id" }
test('appointment template transport fences a switched WABA before any network send', async () => {
    const f = fixture('other-account')
    await assert.rejects(f.sender(input), /business account changed/)
    assert.equal(f.calls.length, 0)
})
test('appointment template transport carries the deadline and canonical callback identifier', async () => {
    const f = fixture(), signal = new AbortController().signal
    await f.sender({ ...input, signal })
    assert.equal(f.calls.length, 1)
    assert.equal(f.calls[0].options.signal, signal)
    const payload = JSON.parse(String(f.calls[0].options.body))
    assert.equal(payload.biz_opaque_callback_data, input.callbackData)
    assert.equal(payload.template.name, input.templateName)
    assert.equal(payload.to, '12025550123')
})
