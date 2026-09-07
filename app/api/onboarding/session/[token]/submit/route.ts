import { completeCanonicalStep, getCanonicalMutationSessionByToken, ONBOARDING_SESSION_UPDATED_MESSAGE, submitCanonicalFormStep } from "@/lib/onboarding/canonical"
import type { FormResponse } from "@/lib/onboarding/forms"

export const maxDuration = 60

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
    const started = performance.now()
    const responseHeaders = { "Cache-Control": "no-store" }
    const origin = request.headers.get("origin")
    if ((origin && origin !== new URL(request.url).origin) || request.headers.get("sec-fetch-site") === "cross-site") {
        return Response.json({ ok: false, error: "Invalid submission origin." }, { status: 403, headers: responseHeaders })
    }
    try {
        const { token } = await params
        if (!/^[a-f0-9]{64}$/i.test(token)) throw new Error("Invalid onboarding link.")
        if (!request.headers.get("content-type")?.startsWith("application/json")) throw new Error("Invalid submission format.")
        if (Number(request.headers.get("content-length")) > 1_048_576) throw new Error("This submission is too large.")
        const raw = await request.text()
        if (new TextEncoder().encode(raw).length > 1_048_576) throw new Error("This submission is too large.")
        const body = JSON.parse(raw)
        if (!body || typeof body.stepKey !== "string" || body.stepKey.length > 200) throw new Error("Invalid onboarding step.")
        if (body.response !== undefined && (!body.response || typeof body.response !== "object" || Array.isArray(body.response))) throw new Error("Invalid form response.")
        const resolved = await getCanonicalMutationSessionByToken(token, body.stepKey)
        if (!resolved) throw new Error("This onboarding link is no longer available.")
        const compositionHash = resolved.session.composition_hash ?? null
        if (body.compositionHash !== undefined && body.compositionHash !== compositionHash) throw new Error(ONBOARDING_SESSION_UPDATED_MESSAGE)
        const loaded = performance.now()
        const outcome = body.response === undefined
            ? await completeCanonicalStep(token, body.stepKey, undefined, resolved)
            : await submitCanonicalFormStep(token, body.stepKey, body.response as FormResponse, { resolvedSession: resolved })
        const completed = performance.now()
        // JSON acknowledgement avoids the Server Action's current-page RSC
        // render. All authoritative writes and invalidation have finished.
        return Response.json({
            ok: true, ...outcome, compositionHash,
            nextPath: outcome.clientPortalUrl ?? `/onboarding/session/${token}${outcome.nextStepKey ? `?step=${encodeURIComponent(outcome.nextStepKey)}` : ""}`,
        }, { headers: { ...responseHeaders, "Server-Timing": `context;dur=${(loaded - started).toFixed(1)}, commit;dur=${(completed - loaded).toFixed(1)}, total;dur=${(completed - started).toFixed(1)}` } })
    } catch (error) {
        return Response.json({ ok: false, error: error instanceof Error ? error.message : "Could not save this onboarding step." }, { status: 400, headers: responseHeaders })
    }
}
