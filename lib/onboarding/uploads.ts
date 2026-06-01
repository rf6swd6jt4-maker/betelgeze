import { randomUUID } from "crypto"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { getUploadKind, StoredUpload } from "@/lib/onboarding/forms"

export const ONBOARDING_UPLOADS_BUCKET =
    process.env.SUPABASE_ONBOARDING_UPLOADS_BUCKET ?? "onboarding-uploads"

const MAX_FILE_SIZE = 50 * 1024 * 1024

function sanitizeFileName(name: string) {
    return name
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 120)
}

export async function uploadOnboardingFile(
    clientId: string,
    stepKey: string,
    file: File
): Promise<StoredUpload> {
    if (file.size > MAX_FILE_SIZE) {
        throw new Error(`${file.name} is larger than the 50MB upload limit.`)
    }

    const fileName = sanitizeFileName(file.name) || "upload"
    const path = `${clientId}/${stepKey}/${randomUUID()}-${fileName}`

    const { error } = await supabaseAdmin.storage
        .from(ONBOARDING_UPLOADS_BUCKET)
        .upload(path, file, {
            contentType: file.type || "application/octet-stream",
            upsert: false,
        })

    if (error) {
        throw new Error(`Could not upload ${file.name}: ${error.message}`)
    }

    return {
        name: file.name,
        path,
        size: file.size,
        type: file.type || "application/octet-stream",
        kind: getUploadKind(file.type || ""),
    }
}

export async function createUploadSignedUrl(path: string) {
    const { data } = await supabaseAdmin.storage
        .from(ONBOARDING_UPLOADS_BUCKET)
        .createSignedUrl(path, 60 * 60)

    return data?.signedUrl ?? null
}

export async function createUploadSignedUrls(paths: string[]) {
    if (paths.length === 0) {
        return new Map<string, string>()
    }

    const { data } = await supabaseAdmin.storage
        .from(ONBOARDING_UPLOADS_BUCKET)
        .createSignedUrls(paths, 60 * 60)

    return new Map(
        data
            ?.filter((item) => item.signedUrl)
            .map((item) => [item.path, item.signedUrl]) ?? []
    )
}
