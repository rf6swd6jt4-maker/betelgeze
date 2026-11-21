import Link from "next/link"
import { headers } from "next/headers"
import { workspaceTabRedirectUrl } from "@/lib/workspace-tabs"
import { Suspense } from "react"
import { loadOnboardingSessionPage, onboardingPageNumber } from "@/lib/onboarding/session-access"
import { notFound, redirect } from "next/navigation"
import { OnboardingSessionChooser } from "@/components/onboarding/OnboardingSessionChooser"
import { WorkspaceTopBar } from "@/components/workspace/WorkspaceTopBar"
import { ClientContextPanel } from "@/components/workspace/ClientContextPanel"
import { DetailContentLoading, DetailField, DetailFields, DetailFieldsLoading, DetailLoadingLabel, DetailPageHeader } from "@/components/detail"
import { RelationshipOnboardingPreview } from "@/components/onboarding/RelationshipOnboardingPreview"
import { CopyOnboardingLink, OnboardingDangerZone, OnboardingLinkControls } from "@/components/onboarding/OnboardingDetailActions"
import { archiveOnboarding, restartOnboarding, revokeOnboardingToken, rotateOnboardingToken } from "./actions"
import { MODULES } from "@/lib/onboarding/modules"
import { relationshipServiceDisplayName } from "@/lib/onboarding/service-display"
import { Card, RoundPill, SquarePill, Status } from "@/components/ui"
import { FramedClientPageHeader } from "@/components/relationships/FramedClientPageHeader"
import { clientPageTabs } from "@/lib/client-page"
import { relationshipContextShortcuts } from "@/lib/relationship-context"
import { workspaceLayoutFor } from "@/lib/workspace-layout"
import {
    assetHref,
    getRelationship,
    workItemHref,
} from "@/lib/relationships"
import { formatRelativeTime, shortId } from "@/lib/ui/relative-time"
import { accessibleRelationshipIds, fullyAccessibleRelationshipIds, requireWorkspacePanel } from "@/lib/workspace-access"
// The record's data and access scoping live in lib/onboarding/staff-detail.ts, shared with the client page's Onboarding tab.
import { metadataValue, responseEntries, formatFileSize, statusLabel, statusTone, startOnboardingDetailData, type AssetRow, type OnboardingStepDetail, type TimelineItem, type OnboardingRelationship, type OnboardingDetailData } from "@/lib/onboarding/staff-detail"

export const dynamic = "force-dynamic"

type PageProps = {
    params: Promise<{ workspaceSlug: string; relationshipId: string }>
    searchParams: Promise<{ session?: string; page?: string }>
}


function nodeTone(done: boolean, active = false) {
    if (done) return "border-white bg-white text-black"
    if (active) return "border-white bg-black text-white"
    return "border-neutral-700 bg-black text-neutral-400"
}

function CheckIcon({ className = "h-4 w-4" }: { className?: string }) {
    return <svg viewBox="0 0 24 24" aria-hidden="true" className={`${className} fill-none stroke-current stroke-[3.25]`}><path d="m5 12 4 4L19 6" /></svg>
}

function ClockIcon({ className = "h-4 w-4" }: { className?: string }) {
    return <svg viewBox="0 0 24 24" aria-hidden="true" className={`${className} fill-none stroke-current stroke-2`}><circle cx="12" cy="12" r="8" /><path d="M12 8v5l3 2" /></svg>
}

function FileIcon({ className = "h-4 w-4" }: { className?: string }) {
    return <svg viewBox="0 0 24 24" aria-hidden="true" className={`${className} fill-none stroke-current stroke-2`}><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v5h5" /></svg>
}


function TimelineNode({ item }: { item: TimelineItem }) {
    if (item.kind === "start" || item.kind === "final") {
        const isFinal = item.kind === "final"
        const circleClass = "h-10 w-10"
        const iconClass = isFinal ? "h-5 w-5" : "h-4 w-4"
        const labelTone = isFinal ? "text-neutral-100" : item.done ? "text-neutral-100" : "text-neutral-500"
        const body = (
            <>
                <div className={`relative flex ${circleClass} items-center justify-center rounded-full border-2 ${nodeTone(item.done, false)}`}>
                    {item.done ? <CheckIcon className={iconClass} /> : <ClockIcon className={iconClass} />}
                </div>
                <span className={`mt-2 line-clamp-2 w-full whitespace-normal px-1 text-center text-xs font-medium leading-4 ${labelTone}`}>{item.label}</span>
            </>
        )
        return (
            <div className="relative z-10 flex min-w-0 flex-col items-center">
                {item.href ? <a href={item.href} className="relative flex flex-col items-center">{body}</a> : <div className="relative flex flex-col items-center">{body}</div>}
            </div>
        )
    }

    const done = item.step.status === "submitted" || item.step.status === "reviewed"
    const active = item.current
    const body = (
        <>
            <div className={`relative flex h-10 w-10 items-center justify-center rounded-full border-2 text-base font-semibold ${nodeTone(done, active)}`}>
                {done ? <CheckIcon /> : item.visibleNumber}
            </div>
            <span className={`mt-2 line-clamp-2 w-full whitespace-normal px-1 text-center text-xs font-medium leading-4 ${done || active ? "text-neutral-100" : "text-neutral-500"}`}>{item.step.title}</span>
        </>
    )
    return (
        <div className="relative z-10 flex min-w-0 flex-col items-center">
            {done ? <a href={`#${item.step.anchorId}`} className="relative flex flex-col items-center">{body}</a> : <div className="relative flex flex-col items-center">{body}</div>}
        </div>
    )
}

function MobileTimeline({ steps }: { steps: OnboardingStepDetail[] }) {
    const currentStepIndex = steps.findIndex((step) => step.status === "not_submitted" || step.status === "blocked" || step.status === "waiting")
    return (
        <ol className="grid gap-1 sm:hidden">
            {steps.map((step) => {
                const done = step.status === "submitted" || step.status === "reviewed"
                const content = (
                    <>
                        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-sm font-semibold ${nodeTone(done, step.index === currentStepIndex)}`}>
                            {done ? <CheckIcon className="h-3.5 w-3.5" /> : step.index + 1}
                        </span>
                        <span className="min-w-0 flex-1">
                            <span className="block text-sm font-medium text-neutral-100">{step.title}</span>
                            <span className="mt-0.5 block text-xs text-neutral-500">{statusLabel(step.status)}</span>
                        </span>
                    </>
                )
                return (
                    <li key={step.key} className="relative before:absolute before:bottom-[-0.25rem] before:left-[0.96875rem] before:top-8 before:w-px before:bg-neutral-800 last:before:hidden">
                        {done ? (
                            <a href={`#${step.anchorId}`} className="relative flex min-h-12 items-center gap-3 rounded-lg px-2 py-2 hover:bg-[var(--color-surface-hover)]">{content}</a>
                        ) : (
                            <div className="relative flex min-h-12 items-center gap-3 px-2 py-2">{content}</div>
                        )}
                    </li>
                )
            })}
        </ol>
    )
}

function AnswerValue({ value }: { value: unknown }) {
    if (Array.isArray(value)) {
        return <p className="mt-2 text-sm text-neutral-300">{value.length} uploaded file{value.length === 1 ? "" : "s"}</p>
    }
    const text = String(value || "").trim()
    return <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-neutral-100">{text || "No answer provided"}</p>
}

function StepInformationSection({ step, workspaceSlug }: { step: OnboardingStepDetail; workspaceSlug: string }) {
    const answers = [...responseEntries(step.submission, step.fieldLabels, step.formKey), ...step.blockAnswers]
    const uploadsByField = new Map<string, AssetRow[]>()
    const ungroupedUploads: AssetRow[] = []
    for (const upload of step.uploads) {
        const fieldName = metadataValue(upload.metadata, "field_name")
        if (fieldName) uploadsByField.set(fieldName, [...(uploadsByField.get(fieldName) ?? []), upload])
        else ungroupedUploads.push(upload)
    }

    return (
        <section id={step.anchorId} className="scroll-mt-24 border-t border-neutral-900 px-5 py-5 first:border-t-0">
            <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
                <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-medium uppercase tracking-wide text-neutral-500">{step.index + 1}. {step.moduleTitle}</span>
                        <span className={`rounded-full border px-2.5 py-1 text-xs capitalize ${statusTone(step.status)}`}>{statusLabel(step.status)}</span>
                        {step.editRequested ? <span className="rounded-full border border-amber-400/40 bg-amber-950/30 px-2.5 py-1 text-xs text-amber-100">Client requested an edit</span> : null}
                    </div>
                    <h3 className="mt-2 text-xl font-semibold tracking-tight text-neutral-100">{step.title}</h3>
                    <p className="mt-2 max-w-4xl text-sm leading-6 text-neutral-400">{step.description}</p>
                    <p className="mt-2 text-xs text-neutral-600">{step.updatedAt ? `Updated ${formatRelativeTime(step.updatedAt)}` : "No activity yet"}</p>
                </div>
                {step.item ? (
                    <Link href={workItemHref(workspaceSlug, step.item.id)} className="inline-flex min-h-10 shrink-0 items-center rounded-lg border border-card-border px-3 text-sm text-neutral-300 hover:border-neutral-600 hover:text-white">
                        Open task
                    </Link>
                ) : null}
            </div>

            {answers.length > 0 ? (
                <div className="mt-5 grid gap-3">
                    {answers.map((answer) => (
                        <div key={answer.key} className="rounded-lg border border-card-border px-4 py-3">
                            <p className="text-sm font-medium text-neutral-300">{answer.label}</p>
                            <AnswerValue value={answer.value} />
                            {(uploadsByField.get(answer.key) ?? []).length > 0 ? (
                                <div className="mt-3 grid gap-2">
                                    {(uploadsByField.get(answer.key) ?? []).map((upload) => (
                                        <AssetRowLink key={upload.id} asset={upload} workspaceSlug={workspaceSlug} />
                                    ))}
                                </div>
                            ) : null}
                        </div>
                    ))}
                </div>
            ) : (
                <div className="mt-5 rounded-lg border border-dashed border-card-border bg-neutral-950 px-4 py-4">
                    <p className="text-sm font-medium text-neutral-200">
                        {step.kind === "video" && step.status === "submitted" ? "Instruction step completed." : step.status === "not_submitted" ? "Not submitted yet." : "No form answers were captured for this step."}
                    </p>
                    <p className="mt-1 text-sm leading-6 text-neutral-500">
                        {step.kind === "video" ? "This step exists as a completion marker and reference point." : "When the client submits this step, their answers will appear here."}
                    </p>
                </div>
            )}

            {ungroupedUploads.length > 0 ? (
                <div className="mt-4">
                    <p className="text-sm font-medium text-neutral-300">Uploaded assets</p>
                    <div className="mt-2 grid gap-2">
                        {ungroupedUploads.map((upload) => (
                            <AssetRowLink key={upload.id} asset={upload} workspaceSlug={workspaceSlug} />
                        ))}
                    </div>
                </div>
            ) : null}
        </section>
    )
}

function AssetRowLink({ asset, workspaceSlug }: { asset: AssetRow; workspaceSlug: string }) {
    return (
        <Link href={assetHref(workspaceSlug, asset.id)} className="grid gap-2 rounded-lg border border-card-border px-3 py-2 text-sm hover:border-neutral-600 sm:grid-cols-[auto_1fr_auto] sm:items-center">
            <span className="hidden h-8 w-8 items-center justify-center rounded-lg border border-card-border text-neutral-400 sm:inline-flex"><FileIcon /></span>
            <span className="min-w-0">
                <span className="block truncate text-neutral-100">{asset.title}</span>
                <span className="mt-0.5 block text-xs text-neutral-600">{asset.content_type ?? asset.asset_kind ?? "Asset"}</span>
            </span>
            <span className="text-xs text-neutral-500 sm:text-right">{formatFileSize(asset.file_size)}</span>
        </Link>
    )
}


async function OnboardingProgress({ activityPromise }: { activityPromise: OnboardingDetailData["activityPromise"] }) {
    const activity = await activityPromise
    return <>{activity.percentage}%</>
}

async function OnboardingHeaderLabels({ activityPromise }: { activityPromise: OnboardingDetailData["activityPromise"] }) {
    const activity = await activityPromise
    return activity.isTest || activity.sessionStuck ? <>{activity.isTest ? <SquarePill tone="yellow">Test</SquarePill> : null}{activity.sessionStuck ? <SquarePill tone="red">Stuck</SquarePill> : null}</> : null
}

async function OnboardingAssetCount({ activityPromise }: { activityPromise: OnboardingDetailData["activityPromise"] }) {
    return (await activityPromise).scopedAssets.length
}

async function OnboardingUpdated({ activityPromise, fallback }: { activityPromise: OnboardingDetailData["activityPromise"]; fallback: string }) {
    const activity = await activityPromise
    return formatRelativeTime(activity.latestActivity ?? fallback)
}

async function OnboardingFields({ data }: { data: OnboardingDetailData }) {
    const summary = await data.summaryPromise
    return <DetailFields>
        <DetailField label="Progress" icon="progress">
            <Suspense fallback={<DetailLoadingLabel>Calculating</DetailLoadingLabel>}>
                <OnboardingProgress activityPromise={data.activityPromise} />
            </Suspense>
        </DetailField>
        <DetailField label="Status" icon="status" className="lg:border-l lg:border-neutral-900 lg:pl-8">
            <Status label={summary.session?.status === "archived" ? "Archived" : summary.sessionCompleted ? "Completed" : summary.session ? "Active" : "Not started"} tone={summary.session?.status === "archived" ? "grey" : summary.sessionCompleted ? "green" : summary.session ? "yellow" : "grey"} />
        </DetailField>
        <DetailField label="Services" icon="services" className="lg:col-span-2">
            <div className="flex flex-wrap gap-1.5">
                {summary.nativeServiceNames?.map((name, index) => <RoundPill key={`${index}:${name}`} tone="emerald">{name}</RoundPill>)}
                {!summary.nativeServiceNames && summary.scopedServices.map((service) => <RoundPill key={`${service.service_key}:${service.service_revision_id ?? "legacy"}`} tone="emerald">{relationshipServiceDisplayName(service, summary.serviceRevisions)}</RoundPill>)}
                {!(summary.nativeServiceNames?.length ?? summary.scopedServices.length) ? <span className="text-neutral-600">None</span> : null}
            </div>
        </DetailField>
        <DetailField label="Modules" icon="modules" className="lg:col-span-2">
            <div className="flex flex-wrap gap-1.5">
                {summary.scopedSnapshotModules.map((snapshotModule) => <RoundPill key={snapshotModule.id} tone="sky">{snapshotModule.title}</RoundPill>)}
                {!summary.normalizedSnapshot && summary.modules.map((module) => <RoundPill key={module.module_key} tone="sky">{MODULES[module.module_key]?.title ?? module.module_key}</RoundPill>)}
                {!summary.scopedSnapshotModules.length && (Boolean(summary.normalizedSnapshot) || !summary.modules.length) ? <span className="text-neutral-600">None</span> : null}
            </div>
        </DetailField>
    </DetailFields>
}

async function OnboardingActivity({ data, workspaceSlug, relationshipId }: { data: OnboardingDetailData; workspaceSlug: string; relationshipId: string }) {
    const activity = await data.activityPromise
    const previewControl = activity.canOpenCompleteClientSession ? <Suspense fallback={<button type="button" disabled className="min-h-9 px-3 text-sm text-neutral-500">Loading preview…</button>}>
        <RelationshipOnboardingPreview workspaceSlug={workspaceSlug} relationshipId={relationshipId} sessionId={activity.session?.id} />
    </Suspense> : null
    return <>
        <Card padding="none" className="mt-4 overflow-hidden sm:mt-6">
                            <div className="border-b border-neutral-900 px-5 py-4">
                                <div>
                                    <h2 className="text-sm font-semibold">Onboarding timeline</h2>
                                    <p className="mt-1 text-sm text-neutral-500">Completed steps jump to the submitted information below.</p>
                                </div>
                            </div>
                            <div className="px-3 py-3 sm:px-4 sm:py-5">
                                <MobileTimeline steps={activity.steps} />
                                <div className="hidden overflow-x-auto pb-1 sm:block">
                                    <div className="relative grid min-w-max items-start gap-3 px-5" style={{ gridTemplateColumns: `repeat(${activity.timeline.length}, minmax(6.5rem, 1fr))` }}>
                                    <div className="absolute left-[3.25rem] right-[3.25rem] top-5 h-px bg-neutral-800" />
                                    {activity.timeline.map((item, index) => (
                                        <TimelineNode key={item.kind === "step" ? item.step.key : `${item.kind}-${index}`} item={item} />
                                    ))}
                                    </div>
                                </div>
                            </div>
        </Card>

        <Card className="mt-6">
                            <div className="flex flex-col gap-3">
                                <div>
                                    <h2 className="text-base font-semibold">Onboarding link</h2>
                                    <p className="mt-1 text-sm text-neutral-500">Manage the client’s access to onboarding.</p>
                                </div>
                                {activity.session && activity.session.status!=="archived" && activity.canManage ? (
                                    <OnboardingLinkControls
                                        key={`${activity.session.id}:${activity.session.token_version ?? 1}`}
                                        previewControl={previewControl}
                                        initialPath={activity.onboardingUrl}
                                        revoked={Boolean(activity.session.token_revoked_at)}
                                        revokeAction={revokeOnboardingToken.bind(null, workspaceSlug, relationshipId, activity.session.id, Number(activity.session.token_version) || 1)}
                                        rotateAction={rotateOnboardingToken.bind(null, workspaceSlug, relationshipId, activity.session!.id)}
                                    />
                                ) : activity.onboardingUrl && !activity.session?.token_revoked_at && activity.canOpenCompleteClientSession ? (
                                    <div className="flex flex-wrap items-center gap-2">
                                        <CopyOnboardingLink path={activity.onboardingUrl} />
                                        {previewControl}
                                    </div>
                                ) : (
                                    <span className="text-sm text-neutral-500">{activity.session && !activity.canOpenCompleteClientSession ? "The complete client session is restricted because this relationship includes other services." : "No active session"}</span>
                                )}
                            </div>
        </Card>

        <Card padding="none" className="mt-6 overflow-hidden">
                            <div className="border-b border-neutral-900 px-5 py-4">
                                <h2 className="text-sm font-semibold">Client information</h2>
                                <p className="mt-1 text-sm text-neutral-500">Information submitted during onboarding stays available here after fulfilment starts.</p>
                            </div>
                            {activity.steps.length ? activity.steps.map((step) => (
                                <StepInformationSection key={step.key} step={step} workspaceSlug={workspaceSlug} />
                            )) : (
                                <div className="px-5 py-6">
                                    <p className="font-medium text-neutral-100">No onboarding steps generated yet.</p>
                                    <p className="mt-2 text-sm leading-6 text-neutral-500">Start onboarding from the relationship page to generate the client-facing session and step work items.</p>
                                </div>
                            )}
        </Card>

        {activity.canManage ? (
            <OnboardingDangerZone
                hasSession={Boolean(activity.session && activity.session.status!=="archived")}
                archiveAction={archiveOnboarding.bind(null, workspaceSlug, relationshipId, activity.session?.id ?? "")}
                restartAction={restartOnboarding.bind(null, workspaceSlug, relationshipId, activity.session?.id ?? null)}
            />
        ) : null}
    </>
}

async function OnboardingContext({ data, workspaceSlug, relationship, access }: { data: OnboardingDetailData; workspaceSlug: string; relationship: OnboardingRelationship; access: import("@/lib/workspace-access").WorkspaceAccess }) {
    const activity = await data.activityPromise
    return <ClientContextPanel access={access}
        workspaceSlug={workspaceSlug}
        relationship={relationship}
        metrics={[
            { label: "Progress", value: `${activity.percentage}%` },
            { label: "Assets", value: activity.assets.length },
        ]}
    />
}

export default async function OnboardingDetailPage({ params, searchParams }: PageProps) {
    const [{workspaceSlug,relationshipId}, query] = await Promise.all([params,searchParams])
    if (query.session && !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(query.session)) notFound()
    const { workspace, user, role, access } = await requireWorkspacePanel(workspaceSlug, "onboarding")
    const [relationship, allowedRelationshipIds, fullyAllowedRelationshipIds] = await Promise.all([
        getRelationship(workspace.id, relationshipId),
        accessibleRelationshipIds(access),
        fullyAccessibleRelationshipIds(access),
    ])
    if (allowedRelationshipIds && !allowedRelationshipIds.has(relationshipId)) notFound()
    if (!relationship) notFound()
    if (!query.session) {
        const page = onboardingPageNumber(query.page)
        const { sessions, access: sessionAccess, hasMore } = await loadOnboardingSessionPage(workspace.id, user.id, page, relationshipId)
        if (sessions.length === 1 && !hasMore && page === 0) {
            redirect(workspaceTabRedirectUrl(`/${workspaceSlug}/onboarding/${relationshipId}?session=${sessions[0].id}`, (await headers()).get("x-betelgeze-current-path")))
        }
        return <OnboardingSessionChooser chrome={<WorkspaceTopBar userId={user.id} workspace={workspace} workspaceAccess={access} currentProduct="client-work" />} workspaceSlug={workspaceSlug} relationshipId={relationshipId} relationship={relationship} sessions={sessions} sessionAccess={sessionAccess} page={page} hasMore={hasMore} />
    }
    const data = startOnboardingDetailData({
        sessionId:query.session,
        userId:user.id,
        workspaceId: workspace.id,
        workspaceSlug: workspace.slug,
        customOnboardingDomain: workspace.custom_onboarding_domain,
        customOnboardingDomainVerified: workspace.custom_onboarding_domain_status === "verified",
        relationship,
        role,
        allowedServiceIds: access.allowedServiceIds,
        canOpenCompleteClientSession: !fullyAllowedRelationshipIds || fullyAllowedRelationshipIds.has(relationship.id),
    })
    const immediateTestLabel = relationship.source_metadata.is_test === true ? <SquarePill tone="yellow">Test</SquarePill> : null
    const today = workspaceLayoutFor(workspace.id, user.id) === "today"

    return <main className="min-h-screen bg-neutral-950 px-4 py-6 text-white sm:px-6">
        <WorkspaceTopBar userId={user.id} workspace={workspace} workspaceAccess={access} currentProduct="client-work" />
        <div className="mx-auto max-w-[92rem]">
            <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto]">
                <div className="min-w-0">
                    {/* Today layout: this is the Onboarding tab of the client's page (docs/today-layout.md, "Client page"). */}
                    {today ? <FramedClientPageHeader workspaceSlug={workspace.slug} relationshipId={relationship.id} name={relationship.primary_person_name} business={relationship.business_name} phase={relationship.lifecycle_phase}
                        tabs={clientPageTabs(workspace.slug, relationship.id, relationshipContextShortcuts(access.capabilities, true))} active="onboarding"
                        actions={<Suspense fallback={immediateTestLabel}><OnboardingHeaderLabels activityPromise={data.activityPromise} /></Suspense>} />
                    : <DetailPageHeader
                        category="Onboarding"
                        reference={shortId(relationship.id)}
                        title={relationship.primary_person_name}
                        subtitle={relationship.business_name ?? "No company saved"}
                        labels={<Suspense fallback={immediateTestLabel}><OnboardingHeaderLabels activityPromise={data.activityPromise} /></Suspense>}
                        facts={[{ label: "assets", value: <Suspense fallback="—"><OnboardingAssetCount activityPromise={data.activityPromise} /></Suspense> }]}
                        updated={<Suspense fallback={formatRelativeTime(relationship.updated_at)}><OnboardingUpdated activityPromise={data.activityPromise} fallback={relationship.updated_at} /></Suspense>}
                    />}
                    <Suspense fallback={<DetailFieldsLoading label="Loading onboarding details" rows={4} />}>
                        <OnboardingFields data={data} />
                    </Suspense>
                    <Suspense fallback={<DetailContentLoading label="Loading onboarding activity" className="min-h-56" />}>
                        <OnboardingActivity data={data} workspaceSlug={workspace.slug} relationshipId={relationship.id} />
                    </Suspense>
                </div>
                <Suspense fallback={null}>
                    <OnboardingContext data={data} workspaceSlug={workspace.slug} relationship={relationship} access={access} />
                </Suspense>
            </div>
        </div>
        </main>
}
