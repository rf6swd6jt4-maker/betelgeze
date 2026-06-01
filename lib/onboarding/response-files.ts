import { FormResponse, StoredUpload } from "@/lib/onboarding/forms"

function isStoredUpload(value: unknown): value is StoredUpload {
    if (!value || typeof value !== "object") {
        return false
    }

    return (
        "path" in value &&
        typeof (value as { path?: unknown }).path === "string"
    )
}

export function getUploadPathsFromResponse(response: unknown) {
    if (!response || typeof response !== "object") {
        return []
    }

    return Object.values(response as FormResponse).flatMap((value) => {
        if (!Array.isArray(value)) {
            return []
        }

        return value.filter(isStoredUpload).map((file) => file.path)
    })
}
