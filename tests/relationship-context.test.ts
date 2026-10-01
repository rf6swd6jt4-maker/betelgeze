import assert from "node:assert/strict"
import test from "node:test"
import { relationshipContactHref, relationshipContextCanShowService, relationshipContextShortcuts, relationshipContextHref, relationshipContextMatchesRoute } from "../lib/relationship-context.ts"

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
    assert.deepEqual(relationshipContextShortcuts(["fulfilment.manage", "client_connections.manage"], false), ["fulfilment"])
    assert.deepEqual(relationshipContextShortcuts(["fulfilment.manage", "client_connections.manage"], true), ["fulfilment", "client-connections"])
})

test("service context follows full relationship access, service grants, and direct assignment", () => {
    const access = { fullRelationship: false, allowedServiceIds: ["allowed"], userId: "staff" }
    assert.equal(relationshipContextCanShowService({ service_id: "private", assignee_user_id: "other" }, access), false)
    assert.equal(relationshipContextCanShowService({ service_id: "allowed", assignee_user_id: "other" }, access), true)
    assert.equal(relationshipContextCanShowService({ service_id: "private", assignee_user_id: "staff" }, access), true)
    assert.equal(relationshipContextCanShowService({ service_id: null, assignee_user_id: null }, access), false)
    assert.equal(relationshipContextCanShowService({ service_id: "private", assignee_user_id: "other" }, { ...access, fullRelationship: true }), true)
})


test("relationship shortcuts target supported pages and preserve the selected client", () => {
    assert.equal(relationshipContextHref("client-connections", "agency", "client-id"), "/agency/client-connections?relationship=client-id")
    assert.equal(relationshipContextHref("relationships", "agency", "client-id"), "/agency/relationships/client-id")
    assert.equal(relationshipContextHref("onboarding", "agency", "client-id"), "/agency/onboarding/client-id")
    assert.equal(relationshipContextHref("fulfilment", "agency", "client-id"), "/agency/work/client-id")
    assert.equal(relationshipContextHref("relationships", "agency", "a/b?c"), "/agency/relationships/a%2Fb%3Fc")
})

test("late context cannot replace or clear a different route's reference", () => {
    assert.equal(relationshipContextMatchesRoute("/agency/relationships/a", "/agency/relationships/b"), false)
    assert.equal(relationshipContextMatchesRoute("/agency/onboarding/a?session=old", "/agency/onboarding/a?session=new"), false)
    assert.equal(relationshipContextMatchesRoute("/agency/relationships/a?__betelgeze_tab=tab#contact", "/agency/relationships/a"), true)
    assert.equal(relationshipContextMatchesRoute("/agency/onboarding/a?page=1&session=a", "/agency/onboarding/a?session=a&page=1"), true)
    assert.equal(relationshipContextMatchesRoute(undefined, "/agency/relationships/a"), false)
})
