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
import { formatMetaWhatsAppApiError } from "../lib/client-messages/meta-whatsapp-errors.ts"
import { getModuleKeysForServices } from "../lib/onboarding/services.ts"
import { isOnboardingStuck } from "../lib/onboarding/stuck.ts"
import {
    getProjectDeadlineTimestamp,
    parseProjectTimeframeDays,
} from "../lib/onboarding/project-timeframe.ts"

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

test("maps fulfilment services to required onboarding modules", () => {
    assert.deepEqual(
        getModuleKeysForServices([
            "seo",
            "google-ads",
            "landing-page-creation",
        ]),
        ["general-info", "google-search-ads", "website-lp"]
    )
})

test("parses project timeframes for fulfilment deadlines", () => {
    assert.equal(parseProjectTimeframeDays("30 days"), 30)
    assert.equal(parseProjectTimeframeDays("2 weeks"), 14)
    assert.equal(parseProjectTimeframeDays("soon"), null)

    assert.equal(
        getProjectDeadlineTimestamp({
            timeframe: "2 weeks",
            from: new Date("2026-06-15T00:00:00.000Z"),
        }),
        new Date("2026-06-29T00:00:00.000Z").getTime()
    )
})

test("marks incomplete inactive onboarding as stuck", () => {
    assert.equal(
        isOnboardingStuck({
            percentage: 75,
            createdAt: "2026-06-01T00:00:00.000Z",
            lastActivityAt: "2026-06-10T00:00:00.000Z",
            now: new Date("2026-06-15T00:00:00.000Z"),
            stuckAfterDays: 3,
        }),
        true
    )

    assert.equal(
        isOnboardingStuck({
            percentage: 100,
            createdAt: "2026-06-01T00:00:00.000Z",
            lastActivityAt: "2026-06-10T00:00:00.000Z",
            now: new Date("2026-06-15T00:00:00.000Z"),
            stuckAfterDays: 3,
        }),
        false
    )
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
    assert.equal(
        shouldIgnoreClickUpMessage({
            body: "Video: [open video](https://onboarding.scaylup.com/api/client-messages/media/client/video.mp4)",
            authorId: null,
            authorName: "Sarah",
        }),
        true
    )
    assert.equal(
        shouldIgnoreClickUpMessage({
            body: "![Image](https://onboarding.scaylup.com/api/client-messages/media/client/image.jpg)\n[Open image](https://onboarding.scaylup.com/api/client-messages/media/client/image.jpg)",
            authorId: null,
            authorName: "Sarah",
        }),
        true
    )
    assert.equal(
        shouldIgnoreClickUpMessage({
            body: "Could you send a video of the finished room?",
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

test("explains Meta WhatsApp token authentication failures", () => {
    const message = formatMetaWhatsAppApiError({
        action: "Meta WhatsApp message",
        status: 401,
        responseBody: JSON.stringify({
            error: {
                message: "Authentication Error",
                code: 190,
                type: "OAuthException",
            },
        }),
    })

    assert.match(message, /Meta code 190/u)
    assert.match(message, /META_WHATSAPP_ACCESS_TOKEN/u)
})
