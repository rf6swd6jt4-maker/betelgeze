import "server-only"

import { createPrivateUploadSignedUrl, createServiceThumbnailPublicUrl } from "@/lib/onboarding/uploads"
import { serviceTemplateThumbnailSrcFromDefinition } from "@/lib/onboarding/service-templates"

function thumbnailPathFromDefinition(definition: Record<string, unknown>) {
    const value = definition.thumbnailPath ?? definition.thumbnail_path
    return typeof value === "string" && value.trim() ? value : null
}

function absolutePublicAssetUrl(source: string, origin: string | null | undefined) {
    if (!origin || !source.startsWith("/")) return source
    return new URL(source, origin).toString()
}

/** Resolve the exact cover stored by a service revision for app UI or Stripe. */
export async function resolveServiceThumbnailUrl(
    definition: Record<string, unknown>,
    options: { expiresInSeconds?: number; publicOrigin?: string } = {},
) {
    const thumbnailPath = thumbnailPathFromDefinition(definition)
    if (thumbnailPath) {
        return createServiceThumbnailPublicUrl(thumbnailPath)
            ?? await createPrivateUploadSignedUrl(thumbnailPath, options.expiresInSeconds)
    }

    const templateSource = serviceTemplateThumbnailSrcFromDefinition(definition)
    return templateSource ? absolutePublicAssetUrl(templateSource, options.publicOrigin) : null
}
