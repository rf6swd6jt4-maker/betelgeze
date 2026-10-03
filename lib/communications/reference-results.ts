import type { RecordReference, RecordReferenceResult, ReferenceContext } from "../chat-formatting"

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/

/** Reject the entire malformed response before either UI can render a label. */
export function readReferenceResults(value: unknown, context: ReferenceContext, maximum: number, requested?: readonly RecordReference[]): RecordReferenceResult[] {
    const invalid = () => new Error("Could not check reference")
    if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid()
    const envelope = value as { scope?: unknown; results?: unknown }
    if (!envelope.scope || typeof envelope.scope !== "object" || Array.isArray(envelope.scope)) throw invalid()
    const scope = envelope.scope as { userId?: unknown; workspaceId?: unknown }
    if (scope.userId !== context.userId || scope.workspaceId !== context.workspaceId || !Array.isArray(envelope.results) || envelope.results.length > maximum) throw invalid()
    const wanted = requested ? new Set(requested.map(reference => `${reference.type}:${reference.id.toLowerCase()}`)) : null
    const seen = new Set<string>()
    const prefix = `/${encodeURIComponent(context.workspaceSlug)}/`
    return envelope.results.map(entry => {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw invalid()
        const { type, id, label, detail, href } = entry as Record<string, unknown>
        if ((type !== "work_item" && type !== "asset" && type !== "relationship") || typeof id !== "string" || !UUID.test(id)
            || typeof label !== "string" || !label.trim() || label.length > 240 || CONTROL_CHARACTERS.test(label)
            || (detail !== undefined && (typeof detail !== "string" || detail.length > 160 || CONTROL_CHARACTERS.test(detail))) || typeof href !== "string") throw invalid()
        const key = `${type}:${id.toLowerCase()}`
        const routes = type === "work_item" ? ["work-items"] : type === "asset" ? ["assets"] : ["relationships", "onboarding", "work"]
        if (seen.has(key) || (wanted && !wanted.has(key)) || !routes.some(route => href === `${prefix}${route}/${id}`)) throw invalid()
        seen.add(key)
        return { type, id: id.toLowerCase(), label, ...(detail ? { detail } : {}), href }
    })
}
