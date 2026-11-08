import assert from "node:assert/strict"
import test from "node:test"
import { validateWhatsAppEngagementTemplate } from "../lib/client-messages/whatsapp-engagement-template.ts"

function template(overrides: Record<string, unknown> = {}) {
    return {
        name: "be_service_cooperation_call",
        language: "en_US",
        status: "APPROVED",
        category: "UTILITY",
        components: [
            { type: "BODY", text: "We need your assistance to complete the next step of the {{1}} service for {{2}}. The step requires your participation in {{3}}. Reply CALL to arrange a call so we can complete it with you." },
            { type: "BUTTONS", buttons: [{ type: "QUICK_REPLY", text: "Arrange a call" }] },
        ],
        ...overrides,
    }
}

test("an approved Utility template with sequential variables and one quick reply validates", () => {
    const result = validateWhatsAppEngagementTemplate([template()], "be_service_cooperation_call", "en_US", "call-request")
    assert.deepEqual(result, { name: "be_service_cooperation_call", language: "en_US", bodyVariableCount: 3 })
})

test("an unapproved or missing template is rejected", () => {
    assert.throws(() => validateWhatsAppEngagementTemplate([], "be_service_cooperation_call", "en_US", "call-request"), /not approved/)
    assert.throws(() => validateWhatsAppEngagementTemplate([template({ status: "PENDING" })], "be_service_cooperation_call", "en_US", "call-request"), /not approved/)
})

test("a non-Utility template is rejected", () => {
    assert.throws(() => validateWhatsAppEngagementTemplate([template({ category: "MARKETING" })], "be_service_cooperation_call", "en_US", "call-request"), /Marketing templates can be blocked/)
})

test("a header of any kind is rejected", () => {
    const withHeader = template({ components: [{ type: "HEADER", format: "TEXT", text: "Update" }, ...template().components] })
    assert.throws(() => validateWhatsAppEngagementTemplate([withHeader], "be_service_cooperation_call", "en_US", "call-request"), /no header/)
})

test("a missing body is rejected", () => {
    const noBody = template({ components: [{ type: "BUTTONS", buttons: [{ type: "QUICK_REPLY", text: "Arrange a call" }] }] })
    assert.throws(() => validateWhatsAppEngagementTemplate([noBody], "be_service_cooperation_call", "en_US", "call-request"), /text body/)
})

test("non-sequential, gapped, or repeated variables are rejected", () => {
    for (const text of [
        "No variables here.",
        "Has {{2}} only, skipping one.",
        "Repeats {{1}} and {{1}} again.",
        "Out of order {{2}} then {{1}}.",
    ]) {
        const bad = template({ components: [{ type: "BODY", text }, template().components[1]] })
        assert.throws(() => validateWhatsAppEngagementTemplate([bad], "be_service_cooperation_call", "en_US", "call-request"), /sequential/, text)
    }
})

test("a URL button, calling-permission button, or more than one button is rejected", () => {
    for (const buttons of [
        [{ type: "URL", text: "Open" }],
        [{ type: "PHONE_NUMBER", text: "Call us" }],
        [{ type: "QUICK_REPLY", text: "Arrange a call" }, { type: "QUICK_REPLY", text: "Not now" }],
        [],
    ]) {
        const bad = template({ components: [template().components[0], { type: "BUTTONS", buttons }] })
        assert.throws(() => validateWhatsAppEngagementTemplate([bad], "be_service_cooperation_call", "en_US", "call-request"), /quick-reply button/)
    }
})

test("the two-variable weekly report shape also validates", () => {
    const reportTemplate = template({
        name: "be_weekly_report_ready",
        components: [
            { type: "BODY", text: "Your weekly service report for {{1}}, covering {{2}}, is ready. Reply REPORT to receive the written report here and have it added to your client portal." },
            { type: "BUTTONS", buttons: [{ type: "QUICK_REPLY", text: "Send report" }] },
        ],
    })
    const result = validateWhatsAppEngagementTemplate([reportTemplate], "be_weekly_report_ready", "en_US", "weekly-report")
    assert.deepEqual(result, { name: "be_weekly_report_ready", language: "en_US", bodyVariableCount: 2 })
})
