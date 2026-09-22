"use client"

import { useState, type FormEvent } from "react"
import { saveCrmSetupBlockResponse } from "@/app/onboarding/session/[token]/actions"
import type { CrmSetupBlock as CrmSetupBlockDefinition } from "@/lib/onboarding/block-definition"

type SavedResponse = { usesGhl?: unknown; crmName?: unknown }

export function CrmSetupBlock({ block, token, sessionBlockId, initialResponse, locked, preview, satisfied, onSatisfied, onUnsatisfied }: {
    block: CrmSetupBlockDefinition
    token: string
    sessionBlockId?: string
    initialResponse?: unknown
    locked: boolean
    preview: boolean
    satisfied: boolean
    onSatisfied: () => void
    onUnsatisfied: () => void
}) {
    const saved = initialResponse && typeof initialResponse === "object" ? initialResponse as SavedResponse : null
    const [answer, setAnswer] = useState<"yes" | "no" | "">(saved?.usesGhl === true ? "yes" : saved?.usesGhl === false ? "no" : "")
    const [crmName, setCrmName] = useState(typeof saved?.crmName === "string" ? saved.crmName : "")
    const [pending, setPending] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const videoSrc = block.video?.resolvedUrl ?? block.video?.path

    function choose(value: "yes" | "no") {
        setAnswer(value)
        setError(null)
        if (satisfied && (value !== (saved?.usesGhl === true ? "yes" : saved?.usesGhl === false ? "no" : ""))) onUnsatisfied()
    }

    async function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()
        if (!answer) { setError("Choose yes or no."); return }
        if (answer === "no" && !crmName.trim()) { setError("Tell us which CRM you currently use."); return }
        if (preview || !sessionBlockId) { onSatisfied(); return }
        setPending(true); setError(null)
        const result = await saveCrmSetupBlockResponse(token, sessionBlockId, { usesGhl: answer === "yes", crmName: answer === "no" ? crmName : null })
        setPending(false)
        if (!result.ok) { setError(result.error); return }
        onSatisfied()
    }

    return <form onSubmit={submit} className="rounded-2xl border border-black/10 bg-[var(--onboarding-page)] p-5 sm:p-6">
        <h3 className="text-lg font-semibold text-[var(--onboarding-text)]">{block.title}</h3>
        {block.description ? <p className="mt-2 text-sm leading-6 text-[var(--onboarding-muted)]">{block.description}</p> : null}
        <fieldset disabled={locked || pending} className="mt-5 grid gap-3 sm:grid-cols-2">
            <legend className="sr-only">HighLevel account</legend>
            {(["yes", "no"] as const).map((value) => <label key={value} className={`flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 text-sm ${answer === value ? "border-[var(--onboarding-primary)] bg-[var(--onboarding-surface)]" : "border-black/15 bg-[var(--onboarding-surface)]"}`}><input type="radio" name={`crm-${block.id}`} checked={answer === value} onChange={() => choose(value)} />{value === "yes" ? "Yes, we use HighLevel" : "No, we use another CRM"}</label>)}
        </fieldset>
        {answer === "no" ? <label className="mt-4 block text-sm font-medium text-[var(--onboarding-text)]">{block.crmLabel}<input value={crmName} onChange={(event) => { setCrmName(event.target.value); if (satisfied) onUnsatisfied() }} disabled={locked || pending} maxLength={120} required className="mt-2 min-h-12 w-full rounded-xl border border-black/15 bg-[var(--onboarding-surface)] px-4 text-base outline-none focus:border-[var(--onboarding-primary)]" /></label> : null}
        {answer === "yes" ? <div className="mt-5">{videoSrc ? <video src={videoSrc} controls preload="metadata" className="aspect-video w-full rounded-2xl bg-black" /> : <div className="rounded-xl border border-dashed border-black/15 p-4 text-sm leading-6 text-[var(--onboarding-muted)]">Our team will send the short HighLevel access guide here. For now, save your answer and we’ll contact you with the access steps.</div>}</div> : null}
        {error ? <p role="alert" className="mt-3 text-sm text-red-700">{error}</p> : null}
        {!locked ? <button type="submit" disabled={pending || !answer || (answer === "no" && !crmName.trim())} className="mt-5 min-h-12 rounded-xl bg-[var(--onboarding-primary)] px-5 font-medium text-white disabled:opacity-50">{pending ? "Saving…" : satisfied ? "Saved" : "Save CRM details"}</button> : null}
    </form>
}
