"use server"

import { supabaseAdmin } from "@/lib/supabase/admin"
import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import {
    FormResponse,
    getOnboardingForm,
    OnboardingFormDefinition,
} from "@/lib/onboarding/forms"
import { createSignedOnboardingUpload } from "@/lib/onboarding/uploads"
import { syncClientOnboardingStepToClickUp } from "@/lib/client-messages/clickup-channel-setup"

export async function completeStep(token: string, stepKey: string) {
    const { data: client, error: clientError } = await supabaseAdmin
        .from("clients")
        .select("id")
        .eq("session_token", token)
        .single()

    if (clientError || !client) {
        throw new Error("Invalid onboarding session")
    }

    const { error } = await saveStepCompletion(client.id, stepKey)

    if (error) {
        throw new Error("Could not save progress")
    }

    await syncClientOnboardingStepToClickUp({
        clientId: client.id,
        stepKey,
    })

    revalidatePath(`/session/${token}`)
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

async function saveStepCompletion(clientId: string, stepKey: string) {
    const now = new Date().toISOString()
    const { data: existingProgress } = await supabaseAdmin
        .from("client_progress")
        .select("id")
        .eq("client_id", clientId)
        .eq("step_key", stepKey)
        .maybeSingle()

    if (existingProgress) {
        return supabaseAdmin
            .from("client_progress")
            .update({ completed_at: now })
            .eq("id", existingProgress.id)
    }

    return supabaseAdmin.from("client_progress").insert({
        client_id: clientId,
        step_key: stepKey,
        completed_at: now,
    })
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
    const { data: client, error: clientError } = await supabaseAdmin
        .from("clients")
        .select("id")
        .eq("session_token", token)
        .single()

    if (clientError || !client) {
        throw new Error("Invalid onboarding session")
    }

    return createSignedOnboardingUpload(client.id, stepKey, file)
}

export async function submitPreparedFormStep(
    token: string,
    stepKey: string,
    formKey: string,
    response: FormResponse
) {
    const form = getOnboardingForm(formKey)

    if (!form) {
        throw new Error("Unknown onboarding form")
    }

    const { data: client, error: clientError } = await supabaseAdmin
        .from("clients")
        .select("id")
        .eq("session_token", token)
        .single()

    if (clientError || !client) {
        throw new Error("Invalid onboarding session")
    }

    const now = new Date().toISOString()

    const responseRow = {
        client_id: client.id,
        step_key: stepKey,
        response,
        updated_at: now,
    }

    const { data: existingResponse } = await supabaseAdmin
        .from("client_form_responses")
        .select("id")
        .eq("client_id", client.id)
        .eq("step_key", stepKey)
        .maybeSingle()

    const { error: responseError } = existingResponse
        ? await supabaseAdmin
              .from("client_form_responses")
              .update(responseRow)
              .eq("client_id", client.id)
              .eq("step_key", stepKey)
        : await supabaseAdmin.from("client_form_responses").insert(responseRow)

    if (responseError) {
        throw new Error("Could not save form response")
    }

    await completeStep(token, stepKey)
}

export async function skipTestStep(
    token: string,
    stepKey: string,
    formKey?: string
) {
    const { data: client, error: clientError } = await supabaseAdmin
        .from("clients")
        .select("id, is_test")
        .eq("session_token", token)
        .single()

    if (clientError || !client || !client.is_test) {
        throw new Error("Invalid test onboarding session")
    }

    if (formKey) {
        const form = getOnboardingForm(formKey)

        if (form) {
            const now = new Date().toISOString()
            const responseRow = {
                client_id: client.id,
                step_key: stepKey,
                response: createFillerResponse(form),
                updated_at: now,
            }

            const { data: existingResponse } = await supabaseAdmin
                .from("client_form_responses")
                .select("id")
                .eq("client_id", client.id)
                .eq("step_key", stepKey)
                .maybeSingle()

            const { error: responseError } = existingResponse
                ? await supabaseAdmin
                      .from("client_form_responses")
                      .update(responseRow)
                      .eq("client_id", client.id)
                      .eq("step_key", stepKey)
                : await supabaseAdmin
                      .from("client_form_responses")
                      .insert(responseRow)

            if (responseError) {
                throw new Error("Could not save test filler response")
            }
        }
    }

    const { error } = await saveStepCompletion(client.id, stepKey)

    if (error) {
        throw new Error("Could not save progress")
    }

    await syncClientOnboardingStepToClickUp({
        clientId: client.id,
        stepKey,
    })

    revalidatePath(`/session/${token}`)
    redirect(`/session/${token}`)
}
