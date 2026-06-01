"use server"

import { supabaseAdmin } from "@/lib/supabase/admin"
import { revalidatePath } from "next/cache"
import {
    FormResponse,
    getOnboardingForm,
    StoredUpload,
} from "@/lib/onboarding/forms"
import { uploadOnboardingFile } from "@/lib/onboarding/uploads"

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

    revalidatePath(`/session/${token}`)
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

export async function submitFormStep(
    token: string,
    stepKey: string,
    formKey: string,
    formData: FormData
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

    const { data: existingResponse } = await supabaseAdmin
        .from("client_form_responses")
        .select("response")
        .eq("client_id", client.id)
        .eq("step_key", stepKey)
        .maybeSingle()

    const response: FormResponse =
        existingResponse?.response &&
        typeof existingResponse.response === "object"
            ? (existingResponse.response as FormResponse)
            : {}

    for (const field of form.fields) {
        if (field.type === "file") {
            const existingFiles = Array.isArray(response[field.name])
                ? (response[field.name] as StoredUpload[])
                : []

            const files = formData
                .getAll(field.name)
                .filter(
                    (value): value is File =>
                        value instanceof File &&
                        value.size > 0 &&
                        Boolean(value.name)
                )

            const uploadedFiles = await Promise.all(
                files.map((file) =>
                    uploadOnboardingFile(client.id, stepKey, file)
                )
            )

            response[field.name] = [...existingFiles, ...uploadedFiles]
            continue
        }

        response[field.name] = String(formData.get(field.name) ?? "").trim()
    }

    const now = new Date().toISOString()

    const responseRow = {
        client_id: client.id,
        step_key: stepKey,
        response,
        updated_at: now,
    }

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
