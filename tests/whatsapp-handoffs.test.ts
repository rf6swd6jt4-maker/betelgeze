import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { whatsappWindowIsOpen, whatsappReconfirmationNeeded } from "../lib/client-messages/whatsapp-window.ts"
import { selectedOnboardingDestinations } from "../lib/onboarding/selected-delivery.ts"

test("only a recent inbound client message opens the WhatsApp response window", () => {
    const now = Date.UTC(2026, 8, 19, 12)
    assert.equal(whatsappWindowIsOpen(null, now), false)
    assert.equal(whatsappWindowIsOpen(new Date(now - 24 * 60 * 60 * 1000).toISOString(), now), false)
    assert.equal(whatsappWindowIsOpen(new Date(now - 24 * 60 * 60 * 1000 + 1).toISOString(), now), true)
    assert.equal(whatsappWindowIsOpen(new Date(now + 1000).toISOString(), now), false)
    assert.equal(whatsappReconfirmationNeeded({ hasWhatsApp: true, lastInboundAt: null }, now), true)
    assert.equal(whatsappReconfirmationNeeded({ hasWhatsApp: true, lastInboundAt: null, optedOutAt: new Date(now).toISOString() }, now), false)
    assert.equal(whatsappReconfirmationNeeded({ hasWhatsApp: false, lastInboundAt: null }, now), false)
})

test("approved Utility templates are workspace-configured with compatible legacy URL-button delivery", () => {
    const outbox = readFileSync("lib/onboarding/outbox.ts", "utf8")
    const reconfirm = readFileSync("app/api/workspaces/[workspaceSlug]/communications/reconfirm/route.ts", "utf8")
    assert.match(outbox, /scaylup_onboarding_access/u)
    assert.match(outbox, /scaylup_client_portal_access/u)
    assert.match(outbox, /onboarding\.scaylup\.com/u)
    assert.match(outbox, /portal\.scaylup\.com/u)
    assert.match(outbox, /sub_type: "url", index: "0"/u)
    assert.match(outbox, /text: url\.pathname\.slice\(1\)/u)
    assert.match(reconfirm, /config\.reconfirmation_template_name/u)
    assert.match(reconfirm, /config\.reconfirmation_template_language/u)
    assert.doesNotMatch(reconfirm, /scaylup_service_updates_preference/u)
    assert.match(reconfirm, /relationship_messaging_choices/u)
})

test("confirmed WhatsApp sales can deliver a paid onboarding template after the free window closes", () => {
    const payload = { delivery_choices: [{ provider: "meta_whatsapp", address: "+353850000001" }] }
    const choice = { provider: "meta_whatsapp", address: "+353850000001", added: true, enabled: true,
        state: "active", confirmedAt: "2026-09-18T10:00:00Z", confirmationStatus: "confirmed", optedIn: true, canSend: false } as const
    assert.throws(() => selectedOnboardingDestinations(payload, [choice]), /unavailable/u)
    assert.deepEqual(selectedOnboardingDestinations(payload, [choice], true), [{
        provider: "meta_whatsapp", address: "whatsapp:+353850000001", channelId: null, primary: true,
    }])
})
