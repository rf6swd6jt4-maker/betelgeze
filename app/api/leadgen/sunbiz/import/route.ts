import { NextRequest } from "next/server"

import {
    importSunbizOwnerIndexFromText,
    normaliseSunbizImportMode,
    normaliseSunbizImportSourceKey,
} from "@/lib/leadgen/sunbiz-import"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 300

type JsonImportBody = {
    sourceKey?: string
    source_key?: string
    mode?: string
    dryRun?: boolean
    dry_run?: boolean
    text?: string
}

function isAuthorized(request: NextRequest) {
    const secret = process.env.LEADGEN_SUNBIZ_IMPORT_SECRET
    if (!secret) return false
    const authorization = request.headers.get("authorization")
    const importSecret = request.headers.get("x-sunbiz-import-secret")
    return authorization === `Bearer ${secret}` || importSecret === secret
}

function boolValue(value: unknown) {
    if (typeof value === "boolean") return value
    return String(value ?? "").trim().toLowerCase() === "true"
}

async function importPayload(request: NextRequest) {
    const contentType = request.headers.get("content-type") ?? ""
    const url = new URL(request.url)
    if (contentType.includes("multipart/form-data")) {
        const form = await request.formData()
        const file = form.get("file")
        const text = file && typeof file === "object" && "text" in file
            ? await file.text()
            : String(form.get("text") ?? "")
        return {
            sourceKey: normaliseSunbizImportSourceKey(String(form.get("sourceKey") ?? form.get("source_key") ?? "")),
            mode: normaliseSunbizImportMode(String(form.get("mode") ?? "")),
            dryRun: boolValue(form.get("dryRun") ?? form.get("dry_run")),
            text,
        }
    }
    if (contentType.includes("application/json")) {
        const body = await request.json() as JsonImportBody
        return {
            sourceKey: normaliseSunbizImportSourceKey(body.sourceKey ?? body.source_key ?? null),
            mode: normaliseSunbizImportMode(body.mode),
            dryRun: boolValue(body.dryRun ?? body.dry_run),
            text: String(body.text ?? ""),
        }
    }
    return {
        sourceKey: normaliseSunbizImportSourceKey(url.searchParams.get("sourceKey") ?? url.searchParams.get("source_key")),
        mode: normaliseSunbizImportMode(url.searchParams.get("mode")),
        dryRun: boolValue(url.searchParams.get("dryRun") ?? url.searchParams.get("dry_run")),
        text: await request.text(),
    }
}

export async function POST(request: NextRequest) {
    if (!isAuthorized(request)) {
        return Response.json({ error: "Unauthorized" }, { status: 401 })
    }

    const payload = await importPayload(request)
    if (!payload.sourceKey) {
        return Response.json({
            error: "Provide sourceKey as registry.fl.sunbiz or registry.fl.fictitious_names.",
        }, { status: 400 })
    }
    if (!payload.text.trim()) {
        return Response.json({
            error: "Upload an extracted Sunbiz fixed-width .txt file or send its text body.",
        }, { status: 400 })
    }

    try {
        const summary = await importSunbizOwnerIndexFromText({
            sourceKey: payload.sourceKey,
            text: payload.text,
            mode: payload.mode,
            dryRun: payload.dryRun,
        })
        return Response.json({ status: "ok", ...summary })
    } catch (error) {
        const message = error instanceof Error ? error.message : "Sunbiz import failed."
        return Response.json({ error: message }, { status: 500 })
    }
}
