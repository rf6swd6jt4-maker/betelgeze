"use client"

import { useEffect, useState, type ReactNode } from "react"
import { DetailField, DetailFields, type DetailFieldIcon } from "@/components/detail"
import { Assignee, Button } from "@/components/ui"
import { relationshipContactHref, relationshipContextDestinations, relationshipContextHref } from "@/lib/relationship-context"
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
    return <span className="flex min-w-0 flex-wrap items-center gap-x-2">
        {href ? <a href={href} className="min-w-0 break-words text-neutral-200 underline decoration-neutral-700 underline-offset-4 hover:text-white">{value}</a>
            : <span className="min-w-0 break-words">{value}</span>}
        <button data-icon-button type="button" title={`Copy ${kind.toLowerCase()}`} aria-label={`Copy ${kind.toLowerCase()}`} className="inline-flex h-7 w-7 shrink-0 items-center justify-center text-neutral-500 hover:text-white focus-visible:outline focus-visible:outline-neutral-400" onClick={async () => {
            try { await navigator.clipboard.writeText(value); setFeedback(`${kind} copied`) }
            catch { setFeedback("Could not copy. Select the text to copy it.") }
        }}>
            <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" className="h-4 w-4"><rect x="7" y="7" width="10" height="10" rx="2" /><path d="M12 4V3H3v9h1" /></svg>
        </button>
        {feedback ? <span role="status" className="text-xs text-neutral-400">{feedback}</span> : null}
    </span>
}

/**
 * Today layout only: what the client column used to hold beside a relationship, now on the client's own page. How to
 * reach the person, who manages the client and where they came from, then the ways onward: their chat, onboarding,
 * fulfilment and connections. Fields the page already edits below (name, company, role, location, notes, services)
 * are not repeated here.
 */
export function ClientSummary({ context, workspaceSlug, onChat }: {
    context: WorkspaceTabRelationshipContext; workspaceSlug: string
    /** Docks this client's conversation. Absent where the docked Comms panel is not offered; Chat is then a link. */
    onChat?: () => void
}) {
    const fields: Array<{ label: string; icon: DetailFieldIcon; value: ReactNode }> = []
    if (context.primary_email?.trim()) fields.push({ label: "Email", icon: "contact", value: <ContactLink kind="Email" value={context.primary_email.trim()} /> })
    if (context.primary_phone?.trim()) fields.push({ label: "Phone", icon: "contact", value: <ContactLink kind="Phone" value={context.primary_phone.trim()} /> })
    if (!context.teamUnavailable) fields.push({ label: "Manager", icon: "user", value: context.manager ? <Assignee name={context.manager.name} avatarSrc={context.manager.avatarSrc} /> : <span className="text-neutral-400">Unassigned</span> })
    if (context.source_label?.trim()) fields.push({ label: "Source", icon: "source", value: context.source_label.trim() })
    const onward = relationshipContextDestinations.filter(destination => destination.key !== "relationships" && context.allowedDestinations?.includes(destination.key))
    const chatHref = `/${encodeURIComponent(workspaceSlug)}/communications?mode=clients&conversation=${encodeURIComponent(context.id)}`

    return <section data-client-summary aria-label="Client summary">
        {fields.length ? <DetailFields>
            {fields.map((field, index) => <DetailField key={field.label} label={field.label} icon={field.icon} className={index % 2 ? "lg:border-l lg:pl-8" : ""}>{field.value}</DetailField>)}
        </DetailFields> : null}
        <nav aria-label="Client destinations" className="mt-4 flex flex-wrap gap-2">
            {onChat ? <Button size="sm" data-client-chat onClick={onChat}>Chat</Button> : <Button size="sm" data-client-chat href={chatHref}>Chat</Button>}
            {onward.map(destination => <Button key={destination.key} size="sm" variant="secondary" href={relationshipContextHref(destination.key, workspaceSlug, context.id)}>{destination.label}</Button>)}
        </nav>
    </section>
}
