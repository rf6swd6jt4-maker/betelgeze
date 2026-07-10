"use server"

import { redirect } from "next/navigation"
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
    const form = getOnboardingForm(formKey)
    if (!form) throw new Error("Unknown onboarding form")
    await submitCanonicalFormStep(token, stepKey, form, response)
}

export async function skipTestStep(
    token: string,
    stepKey: string,
    formKey?: string
) {
    const { session } = await getPublicSession(token)
    if (!session.is_test) throw new Error("Invalid test onboarding session")

    if (formKey) {
        const form = getOnboardingForm(formKey)
        if (form) {
            await submitCanonicalFormStep(token, stepKey, form, createFillerResponse(form))
            redirect(await getPublicOnboardingPath(token))
        }
    }

    await completeCanonicalStep(token, stepKey)
    redirect(await getPublicOnboardingPath(token))
}
