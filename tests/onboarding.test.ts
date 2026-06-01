import assert from "node:assert/strict"
import test from "node:test"
import { getCompletedStepCount, getProgressPercentage } from "../lib/onboarding/progress.ts"
import {
    getFileAcceptValue,
    getOnboardingForm,
    ONBOARDING_FORMS,
} from "../lib/onboarding/forms.ts"
import { maskToken } from "../lib/security/tokens.ts"

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
