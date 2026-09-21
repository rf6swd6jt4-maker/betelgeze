import assert from "node:assert/strict"
import test from "node:test"
import { validateWhatsAppOnboardingTemplate, whatsappOnboardingTemplateComponents } from "../lib/client-messages/whatsapp-onboarding-template.ts"

const template = (body: string, status = "APPROVED", category = "UTILITY") => [{ name: "onboarding_link", language: "en_US", status, category, components: [{ type: "BODY", text: body }] }]

test("onboarding-link template accepts exactly one secure URL body parameter", () => {
    const validated = validateWhatsAppOnboardingTemplate(template("Open onboarding: {{1}}"), "onboarding_link", "en_US")
    assert.deepEqual(validated, { name: "onboarding_link", language: "en_US", linkParameter: { location: "body" } })
    assert.deepEqual(whatsappOnboardingTemplateComponents(validated, "https://onboarding.scaylup.com/secure"), [
        { type: "body", parameters: [{ type: "text", text: "https://onboarding.scaylup.com/secure" }] },
    ])
})

test("onboarding-link template accepts the Scaylup URL button and its actual language", () => {
    const validated = validateWhatsAppOnboardingTemplate([{
        name: "scaylup_onboarding_access",
        language: "en",
        status: "APPROVED",
        category: "UTILITY",
        components: [
            { type: "BODY", text: "Your onboarding is ready." },
            { type: "BUTTONS", buttons: [{ type: "URL", text: "Open onboarding", url: "https://onboarding.scaylup.com/{{1}}" }] },
        ],
    }], "scaylup_onboarding_access", "en_US")
    assert.deepEqual(validated, {
        name: "scaylup_onboarding_access",
        language: "en",
        linkParameter: { location: "url_button", index: 0, prefix: "https://onboarding.scaylup.com/" },
    })
    assert.deepEqual(whatsappOnboardingTemplateComponents(validated, "https://onboarding.scaylup.com/secure"), [{
        type: "button",
        sub_type: "url",
        index: "0",
        parameters: [{ type: "text", text: "secure" }],
    }])
    assert.throws(() => whatsappOnboardingTemplateComponents(validated, "https://evil.example/secure"), /does not match/u)
})

test("onboarding-link template rejects an unapproved, non-Utility, or incompatible template", () => {
    assert.throws(() => validateWhatsAppOnboardingTemplate(template("Open {{1}}", "PENDING"), "onboarding_link", "en_US"))
    assert.throws(() => validateWhatsAppOnboardingTemplate(template("Open {{1}}", "APPROVED", "MARKETING"), "onboarding_link", "en_US"))
    assert.throws(() => validateWhatsAppOnboardingTemplate(template("Open {{1}} and {{2}}"), "onboarding_link", "en_US"))
    assert.throws(() => validateWhatsAppOnboardingTemplate(template("Open onboarding"), "onboarding_link", "en_US"))
    assert.throws(() => validateWhatsAppOnboardingTemplate([{
        name: "onboarding_link", language: "en_US", status: "APPROVED", category: "UTILITY",
        components: [{ type: "BODY", text: "Open {{1}}" }, { type: "BUTTONS", buttons: [{ type: "URL", url: "https://example.com/{{1}}" }] }],
    }], "onboarding_link", "en_US"))
})
