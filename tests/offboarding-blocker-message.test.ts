import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { isOffboardingGuardMessage, offboardingBlockerMessage } from "../lib/offboarding-blocker-message.ts"

function source(path: string) {
    return readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
}

test("offboarding refusals name the clients and services a person is still on", () => {
    const message = offboardingBlockerMessage({
        person: "Mayank",
        blockers: [
            { client: "Acme Plumbing", detail: "fulfilment manager" },
            { client: "Bright Dental", detail: "Meta Ads, shared service queue" },
        ],
    })
    assert.match(message, /Can't remove Mayank from this workspace yet/)
    assert.match(message, /Acme Plumbing \(fulfilment manager\); Bright Dental \(Meta Ads, shared service queue\)/)
})

test("a service eligibility refusal names the service and caps a long list", () => {
    const blockers = Array.from({ length: 9 }, (_, index) => ({ client: `Client ${index + 1}`, detail: "SEO, shared service queue" }))
    const message = offboardingBlockerMessage({ person: "Mayank", blockers, total: 9, serviceName: "SEO" })
    assert.match(message, /Can't remove Mayank from SEO yet/)
    assert.match(message, /Client 6 \(SEO, shared service queue\); and 3 more/)
    assert.doesNotMatch(message, /Client 7/)
})

test("an empty blocker lookup still gives a usable explanation", () => {
    assert.match(offboardingBlockerMessage({ person: "Mayank", blockers: [] }), /still assigned to active client work/)
    assert.match(offboardingBlockerMessage({ person: "Mayank", blockers: [], serviceName: "SEO" }), /shared SEO queues/)
})

test("only the two database offboarding guards are recognised", () => {
    assert.ok(isOffboardingGuardMessage("This member is assigned to an active client team. Client-team handover must be completed before removal"))
    assert.ok(isOffboardingGuardMessage("Remove this person from shared service assignments before removing their workspace membership or service eligibility"))
    assert.ok(!isOffboardingGuardMessage("duplicate key value violates unique constraint"))
    assert.ok(!isOffboardingGuardMessage(null))
})

test("blocker lookups run only after a guard refusal and are wired into every refusal path", () => {
    assert.match(source("app/[workspaceSlug]/users/actions.ts"), /workspaceRemovalBlockedMessage\(workspace\.id, userId\)/)
    assert.match(source("app/[workspaceSlug]/settings/team-actions.ts"), /isOffboardingGuardMessage\(error\.message\) \? await serviceEligibilityBlockedMessage/)
    assert.match(source("app/[workspaceSlug]/settings/service-actions.ts"), /!outcome\.ok && serviceId && isOffboardingGuardMessage\(outcome\.error\)/)
    const lookup = source("lib/offboarding-blockers.ts")
    assert.doesNotMatch(lookup, /\.limit\(0\)/)
    assert.ok((lookup.match(/\.limit\(/g) ?? []).length >= 6, "every blocker read stays bounded")
})
