import "server-only"
import type { FormResponse, OnboardingFormDefinition, StoredUpload } from "@/lib/onboarding/forms"
import { validateOnboardingUploadFile } from "@/lib/onboarding/forms"
import { getRequiredEnv } from "@/lib/env"
import { inspectOnboardingUpload } from "@/lib/onboarding/uploads"
import { signUploadReceipt, validUploadReceipt, type UploadReceiptScope } from "@/lib/onboarding/upload-receipt"

type Scope = Omit<UploadReceiptScope, "fieldName">

export async function confirmOnboardingUploads(scope: Scope, form: OnboardingFormDefinition, response: FormResponse) {
    const key = getRequiredEnv("SUPABASE_SERVICE_ROLE_KEY")
    const uploads = form.fields.flatMap((field) => {
        const value = response[field.name]
        if (field.type !== "file" || !Array.isArray(value)) return []
        if (!field.multiple && value.length > 1) throw new Error(`${field.label} accepts one file.`)
        return value.map((upload) => ({ field, upload }))
    })
    return Promise.all(uploads.map(async ({ field, upload }) => {
        if (!upload || typeof upload.path !== "string" || typeof upload.name !== "string" || typeof upload.type !== "string" || !Number.isSafeInteger(upload.size)) throw new Error(`${field.label} contains an invalid upload.`)
        validateOnboardingUploadFile(field, upload)
        const prefix = `${scope.workspaceId}/onboarding/${scope.relationshipId}/${scope.sessionId}/${scope.stepKey}/`
        if (!upload.path.startsWith(prefix) || upload.path.slice(prefix.length).includes("/") || !upload.path.slice(prefix.length)) {
            throw new Error("This upload does not belong to the current onboarding step.")
        }
        const receiptScope = { ...scope, fieldName: field.name }
        if (!validUploadReceipt(receiptScope, upload, key)) await inspectOnboardingUpload(upload)
        const confirmed: StoredUpload = { ...upload, receipt: signUploadReceipt(receiptScope, upload, key) }
        return { fieldName: field.name, upload: confirmed }
    }))
}
