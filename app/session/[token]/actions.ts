"use server"

import { supabaseAdmin } from "@/lib/supabase/admin"
import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { headers } from "next/headers"
import {
    FormResponse,
    getOnboardingForm,
    OnboardingFormDefinition,
} from "@/lib/onboarding/forms"
import { createSignedOnboardingUpload } from "@/lib/onboarding/uploads"

async function getPublicSessionClient(token: string) {
    const workspaceSlug = (await headers()).get("x-betelgeze-workspace-slug")
    if (!workspaceSlug) throw new Error("Invalid onboarding session")
    const { data: client, error: clientError } = await supabaseAdmin
        .from("clients")
        .select("id, workspace_id, relationship_id, is_test")
        .eq("session_token", token)
        .single()
    const { data: workspace } = client
        ? await supabaseAdmin.from("workspaces").select("id").eq("id", client.workspace_id).eq("slug", workspaceSlug).eq("status", "active").maybeSingle()
        : { data: null }
    if (clientError || !client || !workspace) {
        throw new Error("Invalid onboarding session")
    }
    return { client, workspaceSlug }
}

async function getPublicSessionPath(workspaceSlug: string, token: string) {
    return (await headers()).get("x-betelgeze-custom-onboarding-domain")
        ? `/${token}`
        : `/onboarding/${workspaceSlug}/${token}`
}

export async function completeStep(token: string, stepKey: string) {
    const { client, workspaceSlug } = await getPublicSessionClient(token)

    const { error } = await saveStepCompletion(client.id, stepKey, client.relationship_id)

    if (error) {
        throw new Error("Could not save progress")
    }

    revalidatePath(`/onboarding/${workspaceSlug}/${token}`)
    revalidatePath(`/dashboard/${workspaceSlug}`)
    if (client.relationship_id) revalidatePath(`/dashboard/${workspaceSlug}/relationships/${client.relationship_id}`)
    revalidatePath("/admin")
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

async function saveStepCompletion(clientId: string, stepKey: string, relationshipId?: string | null) {
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
        relationship_id: relationshipId ?? null,
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
    const { client } = await getPublicSessionClient(token)

    return createSignedOnboardingUpload(client.workspace_id, client.id, stepKey, file)
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

    const { client } = await getPublicSessionClient(token)

    const now = new Date().toISOString()

    const responseRow = {
        client_id: client.id,
        workspace_id: client.workspace_id,
        relationship_id: client.relationship_id,
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
    const { client, workspaceSlug } = await getPublicSessionClient(token)

    if (!client.is_test) {
        throw new Error("Invalid test onboarding session")
    }

    if (formKey) {
        const form = getOnboardingForm(formKey)

        if (form) {
            const now = new Date().toISOString()
            const responseRow = {
                client_id: client.id,
                workspace_id: client.workspace_id,
                relationship_id: client.relationship_id,
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

    const { error } = await saveStepCompletion(client.id, stepKey, client.relationship_id)

    if (error) {
        throw new Error("Could not save progress")
    }

    revalidatePath(`/onboarding/${workspaceSlug}/${token}`)
    revalidatePath(`/dashboard/${workspaceSlug}`)
    if (client.relationship_id) revalidatePath(`/dashboard/${workspaceSlug}/relationships/${client.relationship_id}`)
    revalidatePath("/admin")
    redirect(await getPublicSessionPath(workspaceSlug, token))
}
