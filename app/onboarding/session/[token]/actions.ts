"use server"

import { getOnboardingForm, OnboardingFormDefinition, FormResponse } from "@/lib/onboarding/forms"
import {
    completeCanonicalStep,
    getCanonicalSessionByToken,
    getPublicOnboardingPath,
    submitCanonicalFormStep,
} from "@/lib/onboarding/canonical"
import { createSignedRelationshipOnboardingUpload } from "@/lib/onboarding/uploads"

async function getPublicSession(token: string) {
    const session = await getCanonicalSessionByToken(token)
    if (!session) throw new Error("Invalid onboarding session")
    return session
}

function createFillerResponse(form: OnboardingFormDefinition): FormResponse {
    const response: FormResponse = {}

    for (const field of form.fields) {
        if (field.type === "file") {
            response[field.name] = []
            continue
        }

        response[field.name] = `Test response for ${field.label}.`
    }

    return response
}

export async function completeStep(token: string, stepKey: string) {
    await completeCanonicalStep(token, stepKey)
}

export async function prepareDirectUpload(
    token: string,
    stepKey: string,
    file: {
        name: string
        size: number
        type: string
    }
) {
    const { session } = await getPublicSession(token)
    return createSignedRelationshipOnboardingUpload(
        session.workspace_id,
        session.relationship_id,
        session.id,
        stepKey,
        file
    )
}

export async function submitPreparedFormStep(
    token: string,
    stepKey: string,
    formKey: string,
    response: FormResponse
) {
    try {
        const form = getOnboardingForm(formKey)
        if (!form) throw new Error("Unknown onboarding form")
        await submitCanonicalFormStep(token, stepKey, form, response)
        return { ok: true as const }
    } catch (error) {
        return {
            ok: false as const,
            error: error instanceof Error ? error.message : "Could not save this onboarding step.",
        }
    }
}

export async function skipTestStep(
    token: string,
    stepKey: string,
    formKey?: string
) {
    try {
        const { session } = await getPublicSession(token)
        if (!session.is_test) throw new Error("Invalid test onboarding session")

        if (formKey) {
            const form = getOnboardingForm(formKey)
            if (form) {
                await submitCanonicalFormStep(token, stepKey, form, createFillerResponse(form))
                return { ok: true as const, nextPath: await getPublicOnboardingPath(token) }
            }
        }

        await completeCanonicalStep(token, stepKey)
        return { ok: true as const, nextPath: await getPublicOnboardingPath(token) }
    } catch (error) {
        return {
            ok: false as const,
            error: error instanceof Error ? error.message : "Could not skip this test step.",
        }
    }
}
