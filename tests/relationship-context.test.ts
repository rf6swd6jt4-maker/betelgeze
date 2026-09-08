import assert from "node:assert/strict"
import test from "node:test"
import { relationshipContactHref, relationshipContextCanShowService, relationshipContextShortcuts } from "../lib/relationship-context.ts"

test("contact links normalize saved values and reject executable URLs and injected email headers", () => {
    assert.equal(relationshipContactHref("Website", " example.com/contact "), "https://example.com/contact")
    assert.equal(relationshipContactHref("Website", "https://example.com"), "https://example.com/")
    for (const value of ["javascript:alert(1)", "data:text/html,hello", "file:///tmp/example", "https://", ""]) {
        assert.equal(relationshipContactHref("Website", value), null)
    }
    assert.equal(relationshipContactHref("Email", "person+team@example.com"), "mailto:person%2Bteam%40example.com")
    assert.equal(relationshipContactHref("Email", "person@example.com?bcc=other@example.com"), "mailto:person%40example.com%3Fbcc%3Dother%40example.com")
    assert.equal(relationshipContactHref("Email", "person@example.com\r\nBcc:other@example.com"), null)
    assert.equal(relationshipContactHref("Phone", "+353 (01) 234-5678"), "tel:+353012345678")
    assert.equal(relationshipContactHref("Phone", "unknown"), null)
})

test("shortcuts require permissions and Appointment Setting requires an eligible relationship", () => {
    assert.deepEqual(relationshipContextShortcuts([], true), [])
    assert.deepEqual(relationshipContextShortcuts(["onboarding.manage"], true), ["onboarding"])
    assert.deepEqual(relationshipContextShortcuts(["fulfilment.manage", "appointment_setting.manage"], false), ["fulfilment"])
    assert.deepEqual(relationshipContextShortcuts(["fulfilment.manage", "appointment_setting.manage"], true), ["fulfilment", "appointment-setting"])
})

test("service context follows full relationship access, service grants, and direct assignment", () => {
    const access = { fullRelationship: false, allowedServiceIds: ["allowed"], userId: "staff" }
    assert.equal(relationshipContextCanShowService({ service_id: "private", assignee_user_id: "other" }, access), false)
    assert.equal(relationshipContextCanShowService({ service_id: "allowed", assignee_user_id: "other" }, access), true)
    assert.equal(relationshipContextCanShowService({ service_id: "private", assignee_user_id: "staff" }, access), true)
    assert.equal(relationshipContextCanShowService({ service_id: null, assignee_user_id: null }, access), false)
    assert.equal(relationshipContextCanShowService({ service_id: "private", assignee_user_id: "other" }, { ...access, fullRelationship: true }), true)
})
