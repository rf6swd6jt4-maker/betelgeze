"use client"

import { useEffect, useState, type ReactNode } from "react"
import { DetailField, DetailFields, type DetailFieldIcon } from "@/components/detail"
import { Assignee } from "@/components/ui"
import { relationshipContactHref } from "@/lib/relationship-context"
import type { WorkspaceTabRelationshipContext } from "@/lib/workspace-tabs"

/** A contact value as its link plus a copy control, with visible success or failure feedback. */
function ContactLink({ kind, value }: { kind: "Email" | "Phone"; value: string }) {
    const [feedback, setFeedback] = useState("")
    const href = relationshipContactHref(kind, value)
    useEffect(() => {
        if (!feedback) return
        const timeout = window.setTimeout(() => setFeedback(""), 2400)
        return () => window.clearTimeout(timeout)
    }, [feedback])
    // The value and its copy control stay on one line (the value truncates, with the whole of it in its tooltip); the
    // copy feedback wraps beneath.
    return <span className="flex min-w-0 flex-wrap items-center gap-x-2"><span className="flex min-w-0 max-w-full items-center gap-1">
        {href ? <a href={href} title={value} className="min-w-0 truncate text-neutral-200 underline decoration-neutral-700 underline-offset-4 hover:text-white">{value}</a>
            : <span title={value} className="min-w-0 truncate">{value}</span>}
        <button data-icon-button type="button" title={`Copy ${kind.toLowerCase()}`} aria-label={`Copy ${kind.toLowerCase()}`} className="inline-flex h-7 w-7 shrink-0 items-center justify-center text-neutral-500 hover:text-white focus-visible:outline focus-visible:outline-neutral-400" onClick={async () => {
            try { await navigator.clipboard.writeText(value); setFeedback(`${kind} copied`) }
            catch { setFeedback("Could not copy. Select the text to copy it.") }
        }}>
            <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" className="h-4 w-4"><rect x="7" y="7" width="10" height="10" rx="2" /><path d="M12 4V3H3v9h1" /></svg>
        </button></span>
        {feedback ? <span role="status" className="text-xs text-neutral-400">{feedback}</span> : null}
    </span>
}

/**
 * Today layout only: the client's properties, beside the Overview of their page. How to reach the person, who manages
 * the client and where they came from. Fields the page already edits beside it (name, company, role, location, notes,
 * services) are not repeated, and there are no buttons here: Chat is the page's primary action and the client's other
 * things are its tabs (components/relationships/ClientPageHeader.tsx).
 */
export function ClientSummary({ context }: { context: WorkspaceTabRelationshipContext }) {
    const fields: Array<{ label: string; icon: DetailFieldIcon; value: ReactNode }> = []
    if (context.primary_email?.trim()) fields.push({ label: "Email", icon: "contact", value: <ContactLink kind="Email" value={context.primary_email.trim()} /> })
    if (context.primary_phone?.trim()) fields.push({ label: "Phone", icon: "contact", value: <ContactLink kind="Phone" value={context.primary_phone.trim()} /> })
    if (!context.teamUnavailable) fields.push({ label: "Manager", icon: "user", value: context.manager ? <Assignee name={context.manager.name} avatarSrc={context.manager.avatarSrc} /> : <span className="text-neutral-500">Unassigned</span> })
    if (context.source_label?.trim()) fields.push({ label: "Source", icon: "source", value: context.source_label.trim() })
    if (!fields.length) return null
    return <section data-client-summary aria-label="Client details">
        <DetailFields columns={1} className="mt-0! [&>div]:grid-cols-[4.5rem_minmax(0,1fr)] sm:[&>div]:grid-cols-[4.5rem_minmax(0,1fr)]">
            {fields.map(field => <DetailField key={field.label} label={field.label} icon={field.icon}>{field.value}</DetailField>)}
        </DetailFields>
    </section>
}
