import assert from "node:assert/strict"
import test from "node:test"
import { getCompletedStepCount, getProgressPercentage } from "../lib/onboarding/progress.ts"
import {
    getFileAcceptValue,
    getOnboardingForm,
    ONBOARDING_FORMS,
} from "../lib/onboarding/forms.ts"
import { maskToken } from "../lib/security/tokens.ts"
import {
    displayMessageAddress,
    formatClientInboundMessage,
    getEquivalentMessageAddresses,
    normalizeMessageAddress,
    toMetaWhatsAppRecipient,
} from "../lib/client-messages/addresses.ts"
import { shouldIgnoreClickUpMessage } from "../lib/client-messages/clickup-message-filters.ts"
import { parseClickUpWorkspaceId } from "../lib/client-messages/clickup-workspace.ts"

test("counts unique completed onboarding steps", () => {
    const steps = [{ key: "welcome" }, { key: "business-info" }]

    assert.equal(
        getCompletedStepCount(steps, [
            "welcome",
            "welcome",
            "unknown-step",
        ]),
        1
    )
})

test("calculates rounded progress percentage", () => {
    const steps = [
        { key: "welcome" },
        { key: "business-info" },
        { key: "competitors" },
    ]

    assert.equal(getProgressPercentage(steps, ["welcome"]), 33)
})

test("empty step lists are treated as complete", () => {
    assert.equal(getProgressPercentage([], []), 100)
})

test("masks session tokens while preserving enough characters for debugging", () => {
    assert.equal(
        maskToken("1234567890abcdef1234567890abcdef"),
        "123456...abcdef"
    )
})

test("defines every expected client onboarding form", () => {
    assert.deepEqual(Object.keys(ONBOARDING_FORMS).sort(), [
        "accreditations",
        "before-after-images",
        "branding",
        "business-info",
        "competitors",
        "cta-information",
        "history",
        "logo",
        "process",
        "team-pictures",
        "usps",
        "video-assets",
        "web-access",
    ])
})

test("looks up configured form definitions", () => {
    assert.equal(getOnboardingForm("business-info")?.title, "Business information")
    assert.equal(getOnboardingForm("missing-form"), null)
})

test("maps upload accept helpers for browser file inputs", () => {
    assert.equal(getFileAcceptValue("image"), "image/*,.svg,.pdf")
    assert.equal(getFileAcceptValue("video"), "video/*")
})

test("normalizes WhatsApp bridge addresses", () => {
    assert.equal(
        normalizeMessageAddress("+1 (555) 123-4567"),
        "whatsapp:+15551234567"
    )
    assert.equal(
        normalizeMessageAddress("whatsapp:+1 (555) 123-4567"),
        "whatsapp:+15551234567"
    )
    assert.equal(
        normalizeMessageAddress("whatsapp:15551234567"),
        "whatsapp:+15551234567"
    )
    assert.equal(
        normalizeMessageAddress("+353 089 983 1234"),
        "whatsapp:+353899831234"
    )
    assert.equal(
        normalizeMessageAddress("089 983 1234"),
        "whatsapp:+353899831234"
    )
    assert.equal(
        normalizeMessageAddress("00353 089 983 1234"),
        "whatsapp:+353899831234"
    )
    assert.equal(
        normalizeMessageAddress("+353-089-983-1234 x99"),
        "whatsapp:+353899831234"
    )
    assert.equal(
        normalizeMessageAddress("whatsapp:+44 (0) 7700 900123"),
        "whatsapp:+447700900123"
    )
})

test("matches legacy Irish WhatsApp number variants", () => {
    assert.deepEqual(
        getEquivalentMessageAddresses("whatsapp:+353899831234"),
        ["whatsapp:+353899831234", "whatsapp:+3530899831234"]
    )
    assert.deepEqual(
        getEquivalentMessageAddresses("whatsapp:+3530899831234"),
        ["whatsapp:+353899831234", "whatsapp:+3530899831234"]
    )
})

test("converts normalized bridge addresses for Meta WhatsApp sends", () => {
    assert.equal(toMetaWhatsAppRecipient("+1 (555) 123-4567"), "15551234567")
    assert.equal(
        toMetaWhatsAppRecipient("whatsapp:+15551234567"),
        "15551234567"
    )
})

test("shows phone numbers without the bridge channel prefix", () => {
    assert.equal(
        displayMessageAddress("whatsapp:+15551234567"),
        "+15551234567"
    )
})

test("formats the first client message in a run with a client name", () => {
    assert.equal(
        formatClientInboundMessage({
            clientName: "Rick",
            body: "Hello",
        }),
        "**Rick**\nHello"
    )
    assert.equal(
        formatClientInboundMessage({
            clientName: "Rick",
            body: "Another thing",
            showClientName: false,
        }),
        "Another thing"
    )
})

test("ignores ClickUp messages that were posted by the bridge", () => {
    assert.equal(
        shouldIgnoreClickUpMessage({
            body: "**Rick**\nHello",
            authorId: null,
            authorName: null,
        }),
        true
    )
    assert.equal(
        shouldIgnoreClickUpMessage({
            body: "Hello from the team",
            authorId: null,
            authorName: "Sarah",
        }),
        false
    )
})

test("extracts numeric ClickUp workspace IDs from plain IDs or URLs", () => {
    assert.equal(parseClickUpWorkspaceId("9012345678"), "9012345678")
    assert.equal(
        parseClickUpWorkspaceId("https://app.clickup.com/9012345678/v/c/abc"),
        "9012345678"
    )
})
