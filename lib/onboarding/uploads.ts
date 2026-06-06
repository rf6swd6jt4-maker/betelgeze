import { randomUUID } from "crypto"
import {
    DeleteObjectsCommand,
    GetObjectCommand,
    PutObjectCommand,
    S3Client,
} from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import { getRequiredEnv } from "@/lib/env"
import { getUploadKind, StoredUpload } from "@/lib/onboarding/forms"

export const MAX_ONBOARDING_UPLOAD_SIZE = 500 * 1024 * 1024

const R2_SIGNED_URL_TTL_SECONDS = 60 * 60
const R2_BRIDGE_MEDIA_SIGNED_URL_TTL_SECONDS = 7 * 24 * 60 * 60
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

function getPublicR2Url(path: string) {
    const publicBaseUrl = process.env.R2_PUBLIC_BASE_URL?.replace(/\/+$/g, "")

    if (!publicBaseUrl) return null

    const encodedPath = path
        .split("/")
        .map((segment) => encodeURIComponent(segment))
        .join("/")

    return `${publicBaseUrl}/${encodedPath}`
}

function encodeStoragePath(path: string) {
    return path
        .split("/")
        .map((segment) => encodeURIComponent(segment))
        .join("/")
}

export function createClientMessageMediaUrl(
    path: string,
    appBaseUrl = process.env.NEXT_PUBLIC_SITE_URL
) {
    const siteUrl = appBaseUrl?.replace(/\/+$/g, "")

    if (!siteUrl) return null

    return `${siteUrl}/api/client-messages/media/${encodeStoragePath(path)}`
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

export async function createUploadSignedUrl(
    path: string,
    expiresIn = R2_SIGNED_URL_TTL_SECONDS
) {
    const publicUrl = getPublicR2Url(path)

    if (publicUrl) return publicUrl

    return getSignedUrl(
        getR2Client(),
        new GetObjectCommand({
            Bucket: getR2BucketName(),
            Key: path,
        }),
        {
            expiresIn,
        }
    )
}

export async function createPrivateUploadSignedUrl(
    path: string,
    expiresIn = R2_SIGNED_URL_TTL_SECONDS
) {
    return getSignedUrl(
        getR2Client(),
        new GetObjectCommand({
            Bucket: getR2BucketName(),
            Key: path,
        }),
        {
            expiresIn,
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

export async function deleteOnboardingUploads(paths: string[]) {
    const uniquePaths = [...new Set(paths)].filter(Boolean)

    if (uniquePaths.length === 0) {
        return
    }

    for (let index = 0; index < uniquePaths.length; index += 1000) {
        const chunk = uniquePaths.slice(index, index + 1000)

        await getR2Client().send(
            new DeleteObjectsCommand({
                Bucket: getR2BucketName(),
                Delete: {
                    Objects: chunk.map((path) => ({ Key: path })),
                    Quiet: true,
                },
            })
        )
    }
}

export async function storeClientMessageMedia({
    clientId,
    mediaId,
    fileName,
    contentType,
    body,
    appBaseUrl,
}: {
    clientId: string
    mediaId: string
    fileName: string
    contentType: string
    body: Uint8Array
    appBaseUrl?: string
}) {
    const safeFileName = sanitizeFileName(fileName) || "whatsapp-media"
    const path = `${clientId}/client-messages/${randomUUID()}-${mediaId}-${safeFileName}`

    await getR2Client().send(
        new PutObjectCommand({
            Bucket: getR2BucketName(),
            Key: path,
            Body: body,
            ContentType: contentType || "application/octet-stream",
        })
    )

    return {
        path,
        url:
            createClientMessageMediaUrl(path, appBaseUrl) ??
            (await createUploadSignedUrl(
                path,
                R2_BRIDGE_MEDIA_SIGNED_URL_TTL_SECONDS
            )),
    }
}
