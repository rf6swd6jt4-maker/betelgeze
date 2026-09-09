import assert from "node:assert/strict"
import test from "node:test"
import { consentFailureUpdate } from "../lib/client-sales/consent-delivery.ts"
import { validateWhatsAppConsentTemplate } from "../lib/client-messages/whatsapp-consent-template.ts"
import { formatMetaWhatsAppDeliveryError } from "../lib/client-messages/meta-whatsapp-errors.ts"

const original = { flow: "retention_confirmation", communication_primary_provider: "meta_whatsapp", services: ["ads"] }
const sale = { status: "manual_awaiting_whatsapp_confirm", raw_payload: original, consent_template_message_id: "attempt-one", updated_at: "2026-09-09T20:19:24.123456+00:00" }
const failure = { providerMessageId: "attempt-one", statusPayload: { errors: [{ code: 131049 }] }, webhookPayload: { entry: [] } }

test("failed Retention confirmation keeps flow metadata and permits retry", () => {
    const update = consentFailureUpdate(sale, failure)!
    assert.equal(update.status, "manual_consent_template_failed")
    assert.equal(update.consent_template_sent_at, null)
    assert.equal(update.raw_payload.flow, "retention_confirmation")
    assert.deepEqual(update.raw_payload.services, ["ads"])
    assert.equal(update.raw_payload.communication_primary_provider, "meta_whatsapp")
    assert.deepEqual(original, { flow: "retention_confirmation", communication_primary_provider: "meta_whatsapp", services: ["ads"] })
})
test("failure preserves sold and legacy paid lifecycle", () => {
    for (const [status, expected] of [["sold_awaiting_whatsapp_confirm", "sold_confirmation_failed"], ["paid_awaiting_whatsapp_confirm", "paid_consent_template_failed"]]) assert.equal(consentFailureUpdate({ ...sale, status }, failure)?.status, expected)
})
test("late and duplicate failures cannot undo confirmation or a newer attempt", () => {
    for (const status of ["retention_confirmed", "whatsapp_confirmed", "onboarding_created", "paid", "onboarding_payment_pending", "manual_consent_template_failed"]) assert.equal(consentFailureUpdate({ ...sale, status }, failure), null)
    assert.equal(consentFailureUpdate({ ...sale, consent_template_message_id: "attempt-two" }, failure), null)
    assert.equal(consentFailureUpdate({ ...sale, status: "manual_consent_template_sending" }, { ...failure, claimedAt: "old-claim" }), null)
})
test("failure arriving before send finalization uses exact claim and preserves flow", () => {
    assert.equal(consentFailureUpdate({ ...sale, status: "manual_consent_template_sending", consent_template_message_id: null }, { ...failure, claimedAt: sale.updated_at })?.status, "manual_consent_template_failed")
})
const approved = { name: "confirmation", language: "en", category: "UTILITY", status: "APPROVED", components: [{ type: "BODY", text: "Confirm your service communication preference." }, { type: "BUTTONS", buttons: [{ type: "QUICK_REPLY", text: "CONFIRM" }] }] }
test("only an approved compatible confirmation template is accepted", () => {
    assert.equal(validateWhatsAppConsentTemplate([approved], "confirmation", "en").body, approved.components[0].text)
    for (const category of ["MARKETING", "AUTHENTICATION"]) assert.throws(() => validateWhatsAppConsentTemplate([{ ...approved, category }], "confirmation", "en"), /Utility/)
    assert.throws(() => validateWhatsAppConsentTemplate([{ ...approved, status: "PENDING" }], "confirmation", "en"), /not approved/)
    assert.throws(() => validateWhatsAppConsentTemplate([approved], "confirmation", "en_US"), /not approved/)
    assert.throws(() => validateWhatsAppConsentTemplate([{ ...approved, components: [{ type: "BODY", text: "Hello {{1}}, reply CONFIRM" }] }], "confirmation", "en"), /variables/)
    assert.throws(() => validateWhatsAppConsentTemplate([{ ...approved, components: [{ type: "BODY", text: "Reply CONFIRM" }, { type: "BUTTONS", buttons: [{ type: "VOICE_CALL", text: "Choose preference" }] }] }], "confirmation", "en"), /calling-permission/)
})
test("provider errors are actionable and repeated text is deduplicated", () => {
    assert.match(formatMetaWhatsAppDeliveryError({ code: 131049 })!, /marketing delivery restrictions/)
    assert.equal(formatMetaWhatsAppDeliveryError({ title: "Failed", message: "Failed", code: 12 }), "Failed: Meta code 12")
})
