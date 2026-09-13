import type { ReactNode } from "react"
import Link from "next/link"
import { DetailPageHeader } from "@/components/detail"
import { List, ListItem, ListPrimaryRow, ListTitle, ListSecondaryRow } from "@/components/list/List"
import { Status } from "@/components/ui"
import { formatRelativeTime, shortId } from "@/lib/ui/relative-time"
import type { OnboardingPanelSession, OnboardingSessionAccess } from "@/lib/onboarding/session-access"

export function OnboardingSessionChooser({ chrome, workspaceSlug, relationshipId, relationship, sessions, sessionAccess, page, hasMore }: {
    chrome: ReactNode
    workspaceSlug: string
    relationshipId: string
    relationship: { business_name: string | null; primary_person_name: string; updated_at: string }
    sessions: OnboardingPanelSession[]
    sessionAccess: OnboardingSessionAccess
    page: number
    hasMore: boolean
}) {
    return <main className="min-h-screen bg-neutral-950 px-4 py-6 text-white sm:px-6">
        {chrome}
        <div className="mx-auto max-w-7xl">
            <DetailPageHeader category="Onboarding" reference={shortId(relationshipId)} updated={formatRelativeTime(relationship.updated_at)} subtitle="Choose an onboarding session" title={relationship.business_name || relationship.primary_person_name} />
            <List ariaLabel="Onboarding sessions">{sessions.map(session => <ListItem key={session.id}>
                <ListPrimaryRow><ListTitle href={`/${workspaceSlug}/onboarding/${relationshipId}?session=${session.id}`}>{sessionAccess.serviceNamesBySession[session.id]?.join(" · ") || `Onboarding · ${shortId(session.id)}`}</ListTitle><Status className="shrink-0" label={session.status} tone={session.status === "completed" ? "green" : session.status === "archived" ? "grey" : "yellow"} /></ListPrimaryRow>
                <ListSecondaryRow>{new Date(session.created_at).toLocaleDateString()} · {shortId(session.id)}</ListSecondaryRow>
            </ListItem>)}</List>
            {!sessions.length ? <p className="py-6 text-sm text-neutral-500">No onboarding sessions to show.</p> : null}
            {page > 0 || hasMore ? <nav aria-label="Onboarding pages" className="mt-4 flex justify-between gap-3 text-sm">
                {page > 0 ? <Link className="px-3 py-3" href={`?page=${page - 1}`}>Newer sessions</Link> : <span />}
                {hasMore ? <Link className="px-3 py-3" href={`?page=${page + 1}`}>Older sessions</Link> : null}
            </nav> : null}
        </div>
    </main>
}
