import assert from "node:assert/strict"
import test from "node:test"
import { validateWhatsAppOnboardingTemplate } from "../lib/client-messages/whatsapp-onboarding-template.ts"

const template = (body: string, status = "APPROVED", category = "UTILITY") => [{ name: "onboarding_link", language: "en_US", status, category, components: [{ type: "BODY", text: body }] }]

test("onboarding-link template accepts exactly one secure URL body parameter", () => {
    assert.deepEqual(validateWhatsAppOnboardingTemplate(template("Open onboarding: {{1}}"), "onboarding_link", "en_US"), { name: "onboarding_link", language: "en_US" })
})

test("onboarding-link template rejects an unapproved, non-Utility, or incompatible template", () => {
    assert.throws(() => validateWhatsAppOnboardingTemplate(template("Open {{1}}", "PENDING"), "onboarding_link", "en_US"))
    assert.throws(() => validateWhatsAppOnboardingTemplate(template("Open {{1}}", "APPROVED", "MARKETING"), "onboarding_link", "en_US"))
    assert.throws(() => validateWhatsAppOnboardingTemplate(template("Open {{1}} and {{2}}"), "onboarding_link", "en_US"))
    assert.throws(() => validateWhatsAppOnboardingTemplate(template("Open onboarding"), "onboarding_link", "en_US"))
})
