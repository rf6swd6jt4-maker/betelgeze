"use client"

import { useState } from "react"
import { revokeOnboardingToken, rotateOnboardingToken } from "@/app/[workspaceSlug]/onboarding/[relationshipId]/actions"
import { SectionHeading } from "@/components/detail"
import { CopyOnboardingLink, OnboardingLinkControls } from "@/components/onboarding/OnboardingDetailActions"
import { FilterRail, FilterRailButton } from "@/components/panel/FilterRail"
import { LoadingPulse } from "@/components/panel/PanelLoading"
import { SquarePill, Status } from "@/components/ui"
import type { StatusTone } from "@/components/ui"
import Link from "@/components/workspace/WorkspaceLink"
import { createSectionRead } from "@/lib/client-section-read"
import type { ClientOnboarding, ClientOnboardingStep, ClientOnboardingUpload } from "@/lib/onboarding/staff-detail-view"
import { formatRelativeTime } from "@/lib/ui/relative-time"
import { useClientSection } from "./useClientSection"

type Target = { workspaceSlug: string; relationshipId: string; userId: string }

const onboardingRead = createSectionRead<ClientOnboarding>((_response, body) => (body as { error?: string } | null)?.error ?? "Onboarding could not be loaded.")
const keyOf = ({ workspaceSlug, relationshipId, userId }: Target, session: string | null) => `${userId}:${workspaceSlug}:${relationshipId}:${session ?? ""}`
const urlOf = ({ workspaceSlug, relationshipId }: Target, session: string | null) => `/api/workspaces/${encodeURIComponent(workspaceSlug)}/relationships/${encodeURIComponent(relationshipId)}/onboarding${session ? `?session=${encodeURIComponent(session)}` : ""}`

/** Started when the person points at the Onboarding tab, so the section is usually there by the time it opens. */
export function warmClientOnboarding(target: Target) { void onboardingRead.read(keyOf(target, null), urlOf(target, null), target.userId) }

const stepTone: Record<ClientOnboardingStep["status"], StatusTone> = { not_submitted: "grey", submitted: "green", reviewed: "green", waiting: "yellow", blocked: "red", canceled: "grey" }
const date = (value: string) => new Date(value).toLocaleDateString("en-IE", { day: "numeric", month: "short", year: "numeric" })

function Upload({ upload, workspaceSlug }: { upload: ClientOnboardingUpload; workspaceSlug: string }) {
    return <Link href={`/${workspaceSlug}/assets/${upload.id}`} prefetch={false} className="flex min-w-0 items-baseline gap-2 text-sm text-neutral-200 underline decoration-neutral-700 underline-offset-4 hover:text-white">
        <span className="min-w-0 truncate">{upload.title}</span><span className="shrink-0 text-xs text-neutral-500 no-underline">{upload.size}</span>
    </Link>
}

/** One step: a line that says where it stands, opening to what the client submitted. */
function Step({ step, workspaceSlug }: { step: ClientOnboardingStep; workspaceSlug: string }) {
    const count = step.answers.length + step.uploads.length
    const line = <>
        <Status label={step.statusLabel} tone={stepTone[step.status]} compact className="shrink-0" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-neutral-100">{step.title}</span>
        {step.editRequested ? <SquarePill tone="amber" className="shrink-0">Edit requested</SquarePill> : null}
        <span className="hidden min-w-0 max-w-[12rem] shrink truncate text-neutral-500 md:inline">{step.moduleTitle}</span>
        <span className="shrink-0 text-neutral-400 first-letter:uppercase">{step.statusLabel}</span>
        <span className="hidden w-16 shrink-0 text-right tabular-nums text-neutral-500 sm:inline">{step.updatedAt ? formatRelativeTime(step.updatedAt) : "–"}</span>
    </>
    const rowClass = "flex min-h-10 min-w-0 items-center gap-3 px-2 py-1.5 text-[13px]"
    if (!count && !step.taskId) return <div className={rowClass}>{line}</div>
    return <details className="group/step">
        <summary className={`${rowClass} cursor-pointer list-none outline-none transition-colors hover:bg-[var(--color-surface-hover)] focus-visible:bg-[var(--color-surface-hover)] [&::-webkit-details-marker]:hidden`}>{line}</summary>
        <div className="px-2 pb-4 pl-[1.6875rem] pt-1">
            {step.answers.length ? <dl className="grid grid-cols-1 gap-x-4 sm:grid-cols-[minmax(8rem,14rem)_minmax(0,1fr)]">{step.answers.map(answer => <div key={answer.key} className="contents">
                <dt className="pt-1.5 text-sm text-neutral-500">{answer.label}</dt>
                <dd className="min-w-0 pb-1.5 text-sm sm:pt-1.5"><p className="whitespace-pre-wrap break-words leading-6 text-neutral-200">{answer.value}</p>{answer.uploads.length ? <div className="mt-1 flex flex-col gap-1">{answer.uploads.map(upload => <Upload key={upload.id} upload={upload} workspaceSlug={workspaceSlug} />)}</div> : null}</dd>
            </div>)}</dl> : <p className="py-1.5 text-sm text-neutral-500">{step.instruction && step.status === "submitted" ? "Instruction step completed." : step.status === "not_submitted" ? "Not submitted yet." : "No form answers were captured for this step."}</p>}
            {step.uploads.length ? <div className="mt-2 flex flex-col gap-1"><p className="text-xs text-neutral-500">Uploaded files</p>{step.uploads.map(upload => <Upload key={upload.id} upload={upload} workspaceSlug={workspaceSlug} />)}</div> : null}
            {step.taskId ? <p className="pt-2"><Link href={`/${workspaceSlug}/work-items/${step.taskId}`} prefetch={false} className="text-[13px] text-neutral-400 hover:text-neutral-100">Open task</Link></p> : null}
        </div>
    </details>
}

/**
 * The Onboarding section of a client's page: where onboarding stands, each step with what the client submitted, and
 * the client's link. One read the first time the section opens (or is pointed at); it stays mounted afterwards.
 * Restarting or archiving onboarding and the client-view preview stay on the full record, which this links to.
 */
export function ClientOnboardingSection(target: Target) {
    const [chosen, setChosen] = useState<string | null>(null)
    const { data, error, reload } = useClientSection(onboardingRead, keyOf(target, chosen), urlOf(target, chosen), target.userId, true)
    // A different account's or client's answer is never shown.
    const current = data && data.userId === target.userId && data.relationshipId === target.relationshipId ? data : null
    if (!current) return <section aria-label="Onboarding" aria-busy={!error}>
        <SectionHeading>Onboarding</SectionHeading>
        {error ? <p role="alert" className="py-2 text-sm text-red-200">{error} <button type="button" className="min-h-11 underline" onClick={reload}>Retry</button></p>
            : <div className="-mx-2 divide-y divide-card-border border-y border-card-border">{[46, 38, 52, 30].map(width => <div key={width} aria-hidden="true" className="flex min-h-10 items-center px-2"><LoadingPulse className="h-4" style={{ width: `${width}%` }} /></div>)}</div>}
    </section>
    const { record, sessions } = current
    const recordHref = `/${target.workspaceSlug}/onboarding/${target.relationshipId}${record ? `?session=${record.sessionId}` : ""}`
    return <section aria-label="Onboarding" data-client-onboarding className="flex flex-col gap-8">
        {sessions.length > 1 ? <FilterRail ariaLabel="Onboarding sessions" spacing="tight">
            {sessions.map(session => <FilterRailButton key={session.id} selected={(record?.sessionId ?? chosen) === session.id} onClick={() => setChosen(session.id)}>{session.isTest ? "Test · " : ""}{session.status === "completed" ? "Completed" : session.status === "archived" ? "Archived" : "Active"} · {date(session.createdAt)}</FilterRailButton>)}
        </FilterRail> : null}
        {error ? <p role="alert" className="text-xs text-red-300">{error} Showing the last loaded data. <button type="button" className="underline" onClick={reload}>Retry</button></p> : null}
        {!record ? <p className="text-sm text-neutral-400">{sessions.length > 1 ? "Choose a session to see its steps." : "Onboarding has not started for this client."}</p> : <>
            <div>
                <SectionHeading action={<Link href={recordHref} prefetch={false} className="text-[13px] text-neutral-400 hover:text-neutral-100">Open full record</Link>}>
                    {record.completed ? "Onboarding complete" : `${record.done} of ${record.total} steps done`}
                </SectionHeading>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                    <div role="progressbar" aria-label="Onboarding progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={record.percentage} className="h-[3px] w-full max-w-xs overflow-hidden rounded-full bg-white/[0.08]"><div className="h-full rounded-full bg-emerald-300" style={{ width: `${record.percentage}%` }} /></div>
                    {record.isTest ? <SquarePill tone="yellow">Test</SquarePill> : null}
                    {record.stuck ? <SquarePill tone="red">Stuck</SquarePill> : null}
                    {record.status === "archived" ? <Status label="Archived" tone="grey" /> : null}
                </div>
                {record.services.length || record.modules.length ? <p className="pt-3 text-[13px] leading-5 text-neutral-500">
                    {record.services.length ? <><span className="text-neutral-400">{record.services.join(", ")}</span>{record.modules.length ? " · " : ""}</> : null}
                    {record.modules.join(", ")}
                </p> : null}
                {record.steps.length ? <div className="-mx-2 mt-4 divide-y divide-card-border border-y border-card-border">{record.steps.map(step => <Step key={step.key} step={step} workspaceSlug={target.workspaceSlug} />)}</div>
                    : <p className="pt-4 text-sm text-neutral-400">No onboarding steps generated yet. Start onboarding to create the client-facing session and its steps.</p>}
                {record.latestActivity ? <p className="pt-3 text-xs text-neutral-500">Last activity {formatRelativeTime(record.latestActivity)}</p> : null}
            </div>
            <div>
                <SectionHeading>Onboarding link</SectionHeading>
                {!record.link.archived && record.link.canManage
                    ? <OnboardingLinkControls key={`${record.sessionId}:${record.link.tokenVersion}`} previewControl={null} initialPath={record.link.path} revoked={record.link.revoked}
                        // The same commands as the record page. Each is followed by a fresh read, so the next one carries the new token version.
                        revokeAction={async () => { const result = await revokeOnboardingToken(target.workspaceSlug, target.relationshipId, record.sessionId, record.link.tokenVersion); reload(); return result }}
                        rotateAction={async () => { const result = await rotateOnboardingToken(target.workspaceSlug, target.relationshipId, record.sessionId); reload(); return result }} />
                    : record.link.path ? <CopyOnboardingLink path={record.link.path} />
                    : <p className="text-sm text-neutral-500">{!record.link.canOpenComplete ? "The complete client session is restricted because this client has other services." : "No active session"}</p>}
            </div>
        </>}
    </section>
}
