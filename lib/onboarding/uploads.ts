import { randomUUID } from "crypto"
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import { getRequiredEnv } from "@/lib/env"
import { getUploadKind, StoredUpload } from "@/lib/onboarding/forms"

export const MAX_ONBOARDING_UPLOAD_SIZE = 500 * 1024 * 1024

const R2_SIGNED_URL_TTL_SECONDS = 60 * 60
const R2_UPLOAD_URL_TTL_SECONDS = 15 * 60

function getR2Client() {
    return new S3Client({
        region: "auto",
        endpoint: `https://${getRequiredEnv("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com`,
        credentials: {
            accessKeyId: getRequiredEnv("R2_ACCESS_KEY_ID"),
            secretAccessKey: getRequiredEnv("R2_SECRET_ACCESS_KEY"),
        },
    })
}

function getR2BucketName() {
    return getRequiredEnv("R2_BUCKET_NAME")
}

function sanitizeFileName(name: string) {
    return name
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 120)
}

export async function createSignedOnboardingUpload(
    clientId: string,
    stepKey: string,
    file: {
        name: string
        size: number
        type: string
    }
) {
    if (file.size > MAX_ONBOARDING_UPLOAD_SIZE) {
        throw new Error(`${file.name} is larger than the 500MB upload limit.`)
    }

    const fileName = sanitizeFileName(file.name) || "upload"
    const path = `${clientId}/${stepKey}/${randomUUID()}-${fileName}`
    const contentType = file.type || "application/octet-stream"

    const uploadUrl = await getSignedUrl(
        getR2Client(),
        new PutObjectCommand({
            Bucket: getR2BucketName(),
            Key: path,
            ContentType: contentType,
        }),
        {
            expiresIn: R2_UPLOAD_URL_TTL_SECONDS,
        }
    )

    const storedUpload: StoredUpload = {
        name: file.name,
        path,
        size: file.size,
        type: contentType,
        kind: getUploadKind(contentType),
        provider: "r2",
    }

    return {
        uploadUrl,
        storedUpload,
    }
}

export async function createUploadSignedUrl(path: string) {
    return getSignedUrl(
        getR2Client(),
        new GetObjectCommand({
            Bucket: getR2BucketName(),
            Key: path,
        }),
        {
            expiresIn: R2_SIGNED_URL_TTL_SECONDS,
        }
    )
}

export async function createUploadSignedUrls(paths: string[]) {
    if (paths.length === 0) {
        return new Map<string, string>()
    }

    const entries = await Promise.all(
        paths.map(async (path) => [path, await createUploadSignedUrl(path)] as const)
    )

    return new Map(entries)
}
