import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"
import { secureDeliveryLogBody, secureLinkDisplayUrl } from "../lib/onboarding/secure-link-display.ts"

test("secure automated links retain only their origin in Comms", () => {
    const onboardingUrl = "https://onboarding.example.com/0123456789abcdef?step=private"
    const portalUrl = "https://app.example.com/client-portal/session/abcdef0123456789"

    assert.equal(secureLinkDisplayUrl(onboardingUrl), "https://onboarding.example.com/…")
    assert.equal(
        secureDeliveryLogBody(`Open your onboarding: ${onboardingUrl}`, onboardingUrl, "onboarding_link"),
        "Open your onboarding: https://onboarding.example.com/…"
    )
    assert.equal(
        secureDeliveryLogBody(`Open your portal: ${portalUrl}`, portalUrl, "client_portal_link"),
        "Open your portal: https://app.example.com/…"
    )
    assert.equal(secureDeliveryLogBody(onboardingUrl, onboardingUrl, "ordinary_message"), onboardingUrl)
    assert.equal(secureLinkDisplayUrl("javascript:alert(1)"), "Secure link")
})

test("providers receive the full link while Comms persists only the safe display body", async () => {
    const [outbox, legacy, migration] = await Promise.all([
        readFile("lib/onboarding/outbox.ts", "utf8"),
        readFile("lib/client-sales/automation.ts", "utf8"),
        readFile("supabase/migrations/20260914120000_redact_automated_access_links.sql", "utf8"),
    ])
    assert.match(outbox, /const logBody = secureDeliveryLogBody\(body, context\.publicUrl, row\.kind\)/u)
    assert.match(outbox, /body: logBody,[\s\S]*sendCommunicationDeliveries\(\{[\s\S]*body,/u)
    assert.match(legacy, /body: secureDeliveryLogBody\(outboundBody, input\.onboardingUrl, "onboarding_link"\)/u)
    assert.match(legacy, /sendMetaWhatsAppMessage\(\{[\s\S]*outboundBody/u)
    assert.doesNotMatch(legacy, /onboarding_url: input\.onboardingUrl/u)
    assert.match(migration, /in \('onboarding_link', 'module_update', 'client_portal_link'\)/u)
    assert.match(migration, /raw_payload = coalesce\(message\.raw_payload, '\{\}'::jsonb\) - 'onboarding_url'/u)
    assert.doesNotMatch(migration, /session_token/u)
})
