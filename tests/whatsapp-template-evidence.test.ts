import assert from "node:assert/strict"
import test from "node:test"
import { readFileSync } from "node:fs"
import { createRequire, Module } from "node:module"
import { resolve } from "node:path"
import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import ts from "typescript"
import * as evidenceHelpers from "../lib/communications/template-evidence.ts"
const token = "a".repeat(64)
const evidence = { schemaVersion: 1 as const, templateId: "1415800937309351", templateName: "be_appointment_added", language: "en_US", capturedAt: "2026-10-21T12:00:00Z", buttons: [{ index: 0, type: "url" as const, label: "View appointment", url: `https://portal.scaylup.com/appointment/${token}?v=3` }], components: [{ type: "body", parameters: [{ type: "text", text: "Retained private content" }] }], outboxId: "private-outbox", appointmentId: "private-id", appointmentVersion: 3 }
const raw = (value: unknown) => ({ template_evidence: { text: JSON.stringify(value) } })
function load(path: string, dependencies: Record<string, unknown>) {
    const compiled = new Module(resolve(path)) as Module & { _compile: (code: string, filename: string) => void }
    const require = createRequire(resolve(path))
    compiled.require = ((name: string) => name in dependencies ? dependencies[name] : name.startsWith("@/") ? {} : require(name)) as typeof compiled.require
    compiled._compile(ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText, path)
    return compiled.exports
}
const dependencies = { "@/lib/communications/template-evidence": evidenceHelpers }
const { MessageTemplateButtons } = load("components/communications/MessageTemplateButtons.tsx", dependencies)
const { communicationMessageFromRow } = load("lib/communications/server.ts", { ...dependencies, "@/lib/communications/attachments": { communicationAttachmentFromRawPayload: () => null }, "@/lib/communications/resource-upload": { resourceUploadAssetId: () => null } })
test("authorised history projection includes only bounded display evidence and never raw components or identifiers", () => {
    const projected = evidenceHelpers.communicationTemplateEvidenceFromRawPayload(raw(evidence))!
    assert.deepEqual(projected.buttons, evidence.buttons)
    assert.equal(JSON.stringify(projected).includes("private"), false)
    assert.equal("components" in projected, false)
    const row = { id: "message", relationship_id: "relationship", body: "Appointment update", direction: "outbound", provider: "meta_whatsapp", created_at: evidence.capturedAt, raw_payload: raw(evidence) }
    assert.deepEqual(communicationMessageFromRow(row).templateEvidence, projected)
    assert.equal(communicationMessageFromRow({ ...row, direction: "inbound" }).templateEvidence, undefined)
    assert.equal(communicationMessageFromRow({ ...row, provider: "twilio_sms" }).templateEvidence, undefined)
})
test("absent, redacted, malformed and oversized history never invents a button", () => {
    for (const value of [null, {}, { template_name: "be_appointment_added" }, { template_evidence: { text: "[encrypted]" } }, { template_evidence: { text: "x".repeat(8193) } }, raw({}), raw({ ...evidence, capturedAt: "invalid" }), raw({ ...evidence, buttons: Array(11).fill(evidence.buttons[0]) }), raw({ ...evidence, buttons: [{ ...evidence.buttons[0], index: 2 }] })]) assert.equal(evidenceHelpers.communicationTemplateEvidenceFromRawPayload(value), null)
})
test("unsafe or credential-bearing links never render; shortening retains actual safe target", () => {
    for (const url of ["javascript:alert(1)", "data:text/html,test", "http://example.com", "https://user:pass@example.com", "//example.com", "https://example.com/\npath"]) {
        assert.equal(evidenceHelpers.safeTemplateButtonUrl(url), null)
        assert.equal(evidenceHelpers.communicationTemplateEvidenceFromRawPayload(raw({ ...evidence, buttons: [{ ...evidence.buttons[0], url }] })), null)
    }
    assert.equal(evidenceHelpers.templateButtonDestinationLabel(evidence.buttons[0].url), "portal.scaylup.com/appointment/…?…")
    const html = renderToStaticMarkup(React.createElement(MessageTemplateButtons, { evidence, message: { status: "sending", providerMessageId: null, deliveredAt: null, readAt: null } }))
    assert.ok(html.includes(`href="${evidence.buttons[0].url}"`))
    assert.match(html, /rel="noopener noreferrer"/)
    assert.match(html, /referrerPolicy="no-referrer"/)
    assert.match(html, /Prepared for WhatsApp/)
    assert.equal(html.replace(/<[^>]*>/g, "").includes(token), false)
    assert.equal(html.includes("Retained private content"), false)
})
test("message evidence does not confuse preparation, acknowledgement, uncertainty, delivery or clicks", () => {
    const base = { status: "sending", providerMessageId: null as string | null, deliveredAt: null as string | null, readAt: null as string | null }
    const state = evidenceHelpers.templateEvidenceState
    assert.equal(state(base), "Prepared for WhatsApp")
    assert.equal(state({ ...base, status: "sent" }), "Prepared for WhatsApp")
    assert.equal(state({ ...base, status: "sent", providerMessageId: "wamid.fixture" }), "Message accepted by WhatsApp")
    assert.equal(state({ ...base, status: "send_uncertain" }), "Send confirmation pending")
    assert.equal(state({ ...base, status: "delivery_failed" }), "Message failed")
    assert.equal(state({ ...base, status: "whatsapp_delivered" }), "Message reported delivered")
    assert.equal(state({ ...base, readAt: evidence.capturedAt }), "Message reported read")
    assert.equal(JSON.stringify([state(base), state({ ...base, status: "read" })]).includes("clicked"), false)
})
