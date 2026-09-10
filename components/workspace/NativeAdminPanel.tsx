"use client"

import Link from "@/components/workspace/WorkspaceLink"
import { useEffect, useState } from "react"
import { ActivityTrends, ActivityTrendsLoading } from "@/components/admin/ActivityTrends"
import { AdminPanelNav } from "@/components/admin/AdminPanelNav"
import { AdminWorkQueue } from "@/components/admin/AdminWorkQueue"
import { OkrWorkspace } from "@/components/admin/OkrWorkspace"
import { DetailDangerAction, DetailDangerButton, DetailDangerZone, DetailField, DetailFields, DetailPageHeader } from "@/components/detail"
import { List, ListItem, ListPrimaryRow, ListSecondaryRow, ListTitle, ListTrailing } from "@/components/list/List"
import { ListActionMenu } from "@/components/list/ListActionMenu"
import { ListCreatorAvatar } from "@/components/list/ListCreatorAvatar"
import { MobileListActionSurface } from "@/components/list/MobileCardActionSurface"
import { workItemStatusPresentation } from "@/components/list/work-item-presentation"
import { FilterRail, FilterRailCount, FilterRailLink } from "@/components/panel/FilterRail"
import { InstantFilterCount, InstantFilterResults } from "@/components/panel/InstantFilterResults"
import { PanelTabHeader } from "@/components/panel/PanelTabHeader"
import { QuickStats } from "@/components/panel/QuickStats"
import { Assignee, SquarePill, Status, type StatusTone } from "@/components/ui"
import { MAINTENANCE_CATEGORIES, ADMIN_ACTIVITY_CATEGORIES, maintenanceCategoryLabel, adminActivityCategoryLabel } from "@/lib/admin/presentation"
import { formatActivityCount, type AdminActivityMetricBundle } from "@/lib/admin/activity-metrics"
import type { MaintenanceCategory } from "@/lib/admin/maintenance"
import type { AdminActivityCategory, AdminActivityLevel } from "@/lib/admin/activity"
import { formatRelativeTime, shortId } from "@/lib/ui/relative-time"
import { workItemPriorityLabel } from "@/lib/work-item-priority"
import type { NativeAdminSnapshot, loadNativeAdminTrends } from "@/lib/workspace-native-admin"
import { usePathname, useRouter, useSearchParams, useWorkspaceNavigation } from "./WorkspaceNavigation"
function eventStatus(level: AdminActivityLevel): { label: string; tone: StatusTone } {
    if (level === "error") return { label: "Error", tone: "red" }
    if (level === "warning") return { label: "Warning", tone: "yellow" }
    return { label: "Info", tone: "grey" }
}

function readableKey(value: string) {
    return value.replace(/_/g, " ").replace(/^./, (letter) => letter.toUpperCase())
}

function readableValue(value: unknown) {
    if (value === null || value === undefined || value === "") return "—"
    if (typeof value === "object") return JSON.stringify(value, null, 2)
    return String(value)
}

function DetailGrid({ values }: { values: Array<{ label: string; value: unknown; mono?: boolean }> }) {
    return <dl className="grid gap-px overflow-hidden rounded-xl border border-neutral-800 bg-neutral-800 sm:grid-cols-2">
        {values.map((item) => <div key={item.label} className="min-w-0 bg-black px-4 py-3">
            <dt className="text-xs font-medium uppercase tracking-wide text-neutral-600">{item.label}</dt>
            <dd className={`mt-1 break-words text-sm text-neutral-200 ${item.mono ? "font-mono" : ""}`}>{readableValue(item.value)}</dd>
        </div>)}
    </dl>
}


const activityStatus = eventStatus

function DeferredActivityTrends({ data }: { data: Extract<NativeAdminSnapshot, { kind: "admin-activity" }> }) {
    const navigation = useWorkspaceNavigation()
    const active = navigation?.active !== false
    const [metrics, setMetrics] = useState<AdminActivityMetricBundle | null>(null)
    const [error, setError] = useState(false)
    const [retry, setRetry] = useState(0)
    useEffect(() => {
        if (!active || metrics) return
        const controller = new AbortController()
        let cancelled = false
        const run = async () => {
            try {
                const response = await fetch(`/api/workspaces/${encodeURIComponent(data.workspaceSlug)}/panels/admin?section=activity-trends`, { cache: "no-store", signal: controller.signal, headers: { "x-workspace-user": data.userId } })
                if (!response.ok) throw new Error("Activity charts unavailable")
                const result = await response.json() as Awaited<ReturnType<typeof loadNativeAdminTrends>>
                if (result.userId !== data.userId || result.workspaceId !== data.workspaceId) throw new Error("Session changed")
                if (!cancelled) { setError(false); setMetrics(result.metrics) }
            } catch { if (!cancelled) setError(true) }
        }
        void run()
        return () => { cancelled = true; controller.abort() }
    }, [active, data.userId, data.workspaceId, data.workspaceSlug, metrics, retry])
    if (metrics) return <ActivityTrends initialRange={data.range} metrics={metrics} />
    if (error) return <p role="alert" className="mt-5 text-sm text-red-400">Activity charts could not load. <button type="button" className="underline" onClick={() => { setError(false); setRetry((value) => value + 1) }}>Retry</button></p>
    return <ActivityTrendsLoading />
}

function AdminWork({ data }: { data: Extract<NativeAdminSnapshot, { kind: "admin-work" }> }) {
    const { workItems, names, avatarUrls } = data
    return (
        <main className="min-h-full bg-neutral-950 px-4 pb-8 text-white sm:px-6">
            <div className="mx-auto max-w-7xl">
                <PanelTabHeader
                    title="Work Queue"
                    description="Ranked Admin work ordered by timing, dependencies, expected impact, ownership, and available capacity."
                    tabs={<AdminPanelNav workspaceSlug={data.workspaceSlug} active="work" />}
                />
                <AdminWorkQueue items={workItems} workspaceSlug={data.workspaceSlug} currentUserId={data.userId} names={names} avatarUrls={avatarUrls} />
            </div>
        </main>
    )
}

function AdminOkrs({ data }: { data: Extract<NativeAdminSnapshot, { kind: "admin-okrs" }> }) {
    const { okrs, ownerOptions, workItems, names, today } = data
    return (
        <main className="min-h-full bg-neutral-950 px-4 pb-8 text-white sm:px-6">
            <div className="mx-auto max-w-7xl">
                <PanelTabHeader
                    title="OKRs"
                    description="Objectives and measurable Key Results for private workspace administration."
                    tabs={<AdminPanelNav workspaceSlug={data.workspaceSlug} active="okrs" />}
                />
                <OkrWorkspace workspaceSlug={data.workspaceSlug} currentUserId={data.userId} okrs={okrs} ownerOptions={ownerOptions} workItems={workItems} people={names} today={today} />
            </div>
        </main>
    )
}

function AdminMaintenance({ data }: { data: Extract<NativeAdminSnapshot, { kind: "admin-maintenance" }> }) {
    const query = useSearchParams()
    const { items, people } = data
    const selectedCategory = MAINTENANCE_CATEGORIES.includes(query.get("category") as MaintenanceCategory) ? query.get("category") as MaintenanceCategory : null
    const selectedState = query.get("state") === "resolved" ? "resolved" : "open"
    const openItems = items.filter((item) => !["done", "canceled"].includes(item.status))
    const resolvedItems = items.filter((item) => ["done", "canceled"].includes(item.status))
    const criticalItems = openItems.filter((item) => item.severity === "critical")
    const occurrences = items.reduce((total, item) => total + item.occurrence_count, 0)
    const filterHref = (category: MaintenanceCategory | null, state = selectedState) => {
        const params = new URLSearchParams({ state })
        if (category) params.set("category", category)
        return `/${data.workspaceSlug}/admin/maintenance?${params}`
    }
    const filterDefinitions = [{ param: "state", defaultValue: "open" }, { param: "category" }]
    const filterValues = items.map((item) => ({
        id: item.id,
        values: {
            state: ["done", "canceled"].includes(item.status) ? "resolved" : "open",
            category: item.maintenance_category,
        },
    }))
    const filterValuesById = new Map(filterValues.map((item) => [item.id, item.values]))

    return <main className="min-h-full bg-neutral-950 px-4 pb-8 text-white sm:px-6">
        <div className="mx-auto max-w-7xl">
            <PanelTabHeader
                title="Maintenance Queue"
                description="Actionable automation failures deduplicated into accountable Work Items. Repeated fingerprints update the open item; recurrence after resolution creates a new one."
                tabs={<AdminPanelNav workspaceSlug={data.workspaceSlug} active="maintenance" />}
            />

            <QuickStats ariaLabel="Maintenance statistics" items={[
                { label: "Open", value: openItems.length },
                { label: "Resolved", value: resolvedItems.length },
                { label: "Occurrences", value: occurrences, hideOnMobile: true },
                { label: "Critical", value: criticalItems.length },
            ]} />
            <FilterRail ariaLabel="Filter maintenance by state">
                <FilterRailLink href={filterHref(selectedCategory, "open")} selected={selectedState === "open"} instant={{ param: "state", value: "open", defaultValue: "open" }}>Open <FilterRailCount><InstantFilterCount filters={filterDefinitions} items={filterValues} target={{ param: "state", value: "open" }} /></FilterRailCount></FilterRailLink>
                <FilterRailLink href={filterHref(selectedCategory, "resolved")} selected={selectedState === "resolved"} instant={{ param: "state", value: "resolved", defaultValue: "open" }}>Resolved <FilterRailCount><InstantFilterCount filters={filterDefinitions} items={filterValues} target={{ param: "state", value: "resolved" }} /></FilterRailCount></FilterRailLink>
            </FilterRail>
            <FilterRail ariaLabel="Filter maintenance by category" spacing="tight">
                <FilterRailLink href={filterHref(null)} selected={!selectedCategory} instant={{ param: "category", value: null }}>All categories <FilterRailCount><InstantFilterCount filters={filterDefinitions} items={filterValues} target={{ param: "category", value: null }} /></FilterRailCount></FilterRailLink>
                {MAINTENANCE_CATEGORIES.map((category) => <FilterRailLink key={category} href={filterHref(category)} selected={selectedCategory === category} instant={{ param: "category", value: category }}>{maintenanceCategoryLabel(category)} <FilterRailCount><InstantFilterCount filters={filterDefinitions} items={filterValues} target={{ param: "category", value: category }} /></FilterRailCount></FilterRailLink>)}
            </FilterRail>

            <List ariaLabel="Maintenance queue">
                <InstantFilterResults filters={filterDefinitions} items={items.map((item) => {
                    const href = `/${data.workspaceSlug}/work-items/${item.id}`
                    const status = workItemStatusPresentation(item.status)
                    const assignees = item.assignee_ids.map((id) => ({ id, ...(people[id] ?? { name: "Admin", avatarSrc: null }) }))
                    const actions = [
                        { label: "Open work item", href },
                        item.native_href ? { label: "Open source", href: item.native_href } : null,
                        { label: "Copy item ID", copyText: item.id },
                    ]
                    return { id: item.id, values: filterValuesById.get(item.id)!, content: <ListItem className={item.severity === "critical" ? "bg-red-950/[0.08]" : ""} detailPreview={{
                        category: "Work item",
                        reference: shortId(item.id),
                        title: item.title,
                        updated: formatRelativeTime(item.last_occurred_at),
                    }}>
                        <MobileListActionSurface actions={actions} label={`Open actions for ${item.title}`}>
                            <ListPrimaryRow>
                                <ListTitle href={href} className="flex-1">{item.title}</ListTitle>
                                <SquarePill tone={item.severity === "critical" ? "red" : "yellow"} className="shrink-0 capitalize">{item.severity}</SquarePill>
                                <span className="hidden shrink-0 sm:inline-flex"><SquarePill>Admin</SquarePill></span>
                                <Status label={status.label} tone={status.tone} className="ml-auto shrink-0" />
                            </ListPrimaryRow>
                            <ListSecondaryRow>
                                <span className="shrink-0 text-neutral-400">{maintenanceCategoryLabel(item.maintenance_category)}</span>
                                <span className="hidden shrink-0 text-neutral-500 md:inline">{workItemPriorityLabel(item.priority)}</span>
                                <span className="hidden shrink-0 text-neutral-500 sm:inline">{item.occurrence_count} occurrence{item.occurrence_count === 1 ? "" : "s"}</span>
                                <span className="hidden shrink-0 text-neutral-500 xl:inline">First {formatRelativeTime(item.first_occurred_at)}</span>
                                {!assignees.length ? <span className="hidden shrink-0 text-neutral-600 lg:inline">Unassigned</span> : null}
                                <ListTrailing>
                                    <span className="font-mono text-neutral-500">{shortId(item.id)}</span>
                                    <span className="whitespace-nowrap text-neutral-500">{formatRelativeTime(item.last_occurred_at)}</span>
                                    {assignees[0] ? <span className="inline-flex shrink-0 items-center gap-1" aria-label={`Assigned to ${assignees.map((assignee) => assignee.name).join(", ")}`}>
                                        <Assignee userId={assignees[0].id} name={assignees[0].name} avatarSrc={assignees[0].avatarSrc} compact compactSize="md" />
                                        {assignees.length > 1 ? <span className="text-xs text-neutral-500">+{assignees.length - 1}</span> : null}
                                    </span> : null}
                                    <ListActionMenu actions={actions} className="hidden sm:block" />
                                </ListTrailing>
                            </ListSecondaryRow>
                        </MobileListActionSurface>
                    </ListItem> }
                })} empty={<div className="p-6">
                    <p className="text-lg font-semibold">No maintenance items match these filters.</p>
                    <p className="mt-2 text-sm text-neutral-400">Choose another state or category to broaden this queue.</p>
                </div>} />
            </List>
        </div>
    </main>
}

function AdminActivity({ data }: { data: Extract<NativeAdminSnapshot, { kind: "admin-activity" }> }) {
    const { category, level, range, events, actors, facets, nextCursor } = data
    const filterHref = (nextCategory: AdminActivityCategory | null, nextLevel = level, nextRange = range) => {
        const params = new URLSearchParams()
        params.set("range", nextRange)
        if (nextCategory) params.set("category", nextCategory)
        if (nextLevel) params.set("level", nextLevel)
        const suffix = params.toString()
        return `/${data.workspaceSlug}/admin/activity${suffix ? `?${suffix}` : ""}`
    }

    return <main className="min-h-full bg-neutral-950 px-4 pb-8 text-white sm:px-6">
        <div className="mx-auto max-w-7xl">
            <PanelTabHeader
                title="Activity Console"
                description="Event stream of recorded operations across services, onboarding, billing, communications, Lead Gen, integrations, and Gantt automation."
                tabs={<AdminPanelNav workspaceSlug={data.workspaceSlug} active="activity" />}
            />

            <DeferredActivityTrends key={`${data.workspaceId}:${data.userId}`} data={data} />

            <FilterRail ariaLabel="Filter activity by level">
                <FilterRailLink href={filterHref(category, null)} selected={!level}>All <FilterRailCount>{formatActivityCount(facets.levelTotal)}</FilterRailCount></FilterRailLink>
                {(["info", "warning", "error"] as const).map((item) => <FilterRailLink key={item} href={filterHref(category, item)} selected={level === item}><span className="capitalize">{item}</span> <FilterRailCount>{formatActivityCount(facets.byLevel[item])}</FilterRailCount></FilterRailLink>)}
            </FilterRail>
            <FilterRail ariaLabel="Filter activity by category" spacing="tight">
                <FilterRailLink href={filterHref(null)} selected={!category}>All activities <FilterRailCount>{formatActivityCount(facets.categoryTotal)}</FilterRailCount></FilterRailLink>
                {ADMIN_ACTIVITY_CATEGORIES.map((item) => <FilterRailLink key={item} href={filterHref(item)} selected={category === item}>{adminActivityCategoryLabel(item)} <FilterRailCount>{formatActivityCount(facets.byCategory[item])}</FilterRailCount></FilterRailLink>)}
            </FilterRail>

            <List ariaLabel="Activity log">
                {events.length ? events.map((event) => {
                    const details = event.details
                    const status = activityStatus(event.level)
                    const actor = event.actor_user_id ? actors[event.actor_user_id] ?? { name: "Workspace user", avatarSrc: null } : null
                    const sourceIsExternal = Boolean(event.source_href?.startsWith("http://") || event.source_href?.startsWith("https://"))
                    const detailHref = `/${data.workspaceSlug}/admin/activity/${event.id}`
                    const actions = [
                        { label: "Open details", href: detailHref },
                        event.source_href ? { label: "Open source", href: event.source_href, external: sourceIsExternal } : null,
                        { label: "Copy event ID", copyText: event.id },
                    ]
                    return <ListItem key={event.id} className={event.level === "error" ? "bg-red-950/[0.08]" : ""} detailPreview={{
                        category: "Activity event",
                        reference: shortId(event.id),
                        title: event.summary,
                        subtitle: event.event_key,
                        updated: formatRelativeTime(event.occurred_at),
                    }}>
                        <MobileListActionSurface actions={actions} label={`Open actions for ${event.summary}`}>
                            <ListPrimaryRow>
                                <ListTitle href={detailHref} className="flex-1">{event.summary}</ListTitle>
                                <span className="hidden shrink-0 sm:inline-flex"><SquarePill>{adminActivityCategoryLabel(event.category)}</SquarePill></span>
                                <Status label={status.label} tone={status.tone} className="ml-auto shrink-0" />
                            </ListPrimaryRow>
                            <ListSecondaryRow>
                                <span className="min-w-0 flex-1 truncate font-mono text-xs text-neutral-500">{event.event_key}</span>
                                {details ? <span className="hidden min-w-0 max-w-sm truncate text-neutral-500 xl:inline">{details}</span> : null}
                                {event.entity_id ? <span className="hidden shrink-0 text-neutral-500 md:inline">{event.entity_type ?? "Record"} {shortId(event.entity_id)}</span> : null}
                                <ListTrailing>
                                    <span className="font-mono text-neutral-500">{shortId(event.id)}</span>
                                    <span className="whitespace-nowrap text-neutral-500">{formatRelativeTime(event.occurred_at)}</span>
                                    {actor ? <Assignee name={actor.name} avatarSrc={actor.avatarSrc} compact compactSize="md" /> : <span title="Betelgeze automation"><ListCreatorAvatar src={null} username={null} className="h-6 w-6" /></span>}
                                    <ListActionMenu actions={actions} className="hidden sm:block" />
                                </ListTrailing>
                            </ListSecondaryRow>
                        </MobileListActionSurface>
                    </ListItem>
                }) : <div className="p-6">
                    <p className="text-lg font-semibold">No activity matches these filters.</p>
                    <p className="mt-2 text-sm text-neutral-400">Choose another level or category to broaden the event stream.</p>
                </div>}
            </List>
            {nextCursor ? <div className="mt-4 flex justify-center">
                <Link className="rounded-lg border border-neutral-700 bg-neutral-900 px-4 py-2 text-sm font-medium text-neutral-200 hover:border-neutral-500 hover:text-white" href={`${filterHref(category, level)}${filterHref(category, level).includes("?") ? "&" : "?"}cursor=${encodeURIComponent(nextCursor)}`}>Older activity</Link>
            </div> : null}
        </div>
    </main>
}

function AdminActivityDetail({ data }: { data: Extract<NativeAdminSnapshot, { kind: "admin-activity-detail" }> }) {
    const { event, timeline, metadata, diagnostics, actorName, actorAvatar } = data
    const status = eventStatus(event.level)
    const relationshipId = typeof metadata.relationship_id === "string" ? metadata.relationship_id : null
    const sessionId = typeof metadata.session_id === "string" ? metadata.session_id : event.entity_type === "onboarding_session" ? event.entity_id : null
    const moduleId = typeof metadata.module_id === "string" ? metadata.module_id : event.entity_type === "onboarding_module" ? event.entity_id : null
    const serviceId = typeof metadata.service_id === "string" ? metadata.service_id : event.entity_type === "onboarding_service" ? event.entity_id : null
    const metadataEntries = Object.entries(metadata)
    const diagnosticEntries = Object.entries(diagnostics)
    const errorCode = diagnostics.error_code ?? metadata.error_code
    const automationStage = diagnostics.automation_stage ?? metadata.automation_stage ?? metadata.stage
    const providerSummary = diagnostics.provider_response_summary ?? metadata.provider_response_summary

    return <main className="min-h-full bg-neutral-950 px-4 pb-8 text-white sm:px-6">
        <div className="mx-auto max-w-7xl">
            <AdminPanelNav workspaceSlug={data.workspaceSlug} active="activity" />

            <div className="mt-5">
                <DetailPageHeader
                    category="Activity event"
                    reference={shortId(event.id)}
                    title={event.summary}
                    subtitle={event.event_key}
                    labels={<SquarePill>{adminActivityCategoryLabel(event.category)}</SquarePill>}
                    updated={formatRelativeTime(event.occurred_at)}
                />
            </div>

            <DetailFields>
                <DetailField label="Occurred" icon="time">{new Date(event.occurred_at).toLocaleString("en-IE", { dateStyle: "medium", timeStyle: "medium", timeZone: "Europe/Dublin" })}</DetailField>
                <DetailField label="Actor" icon="user" className="lg:border-l lg:border-neutral-900 lg:pl-8"><Assignee name={actorName} avatarSrc={actorAvatar} compact /></DetailField>
                <DetailField label="Status" icon="status"><Status label={status.label} tone={status.tone} /></DetailField>
                <DetailField label="Actor kind" icon="identity" className="lg:border-l lg:border-neutral-900 lg:pl-8">{event.actor_kind ?? (event.actor_user_id ? "staff" : "automation")}</DetailField>
                <DetailField label="Correlation" icon="dependency"><span className="font-mono">{event.correlation_id ?? "—"}</span></DetailField>
                <DetailField label="Causation" icon="dependency" className="lg:border-l lg:border-neutral-900 lg:pl-8"><span className="font-mono">{event.causation_event_id ?? "—"}</span></DetailField>
                <DetailField label="Entity" icon="relationship">{event.entity_id ? <span className="font-mono">{event.entity_type ?? "record"} {event.entity_id}</span> : <span className="text-neutral-600">None</span>}</DetailField>
                <DetailField label="Classification" icon="activity" className="lg:border-l lg:border-neutral-900 lg:pl-8">{event.metric_classification ?? "audit"}</DetailField>
                <DetailField label="Links" icon="source" className="lg:col-span-2">
                    <div className="flex flex-wrap gap-x-3 gap-y-1">
                        <Link href={`/${data.workspaceSlug}/admin/activity`} className="text-sky-300 hover:text-sky-200">Back to Activity</Link>
                        {event.source_href ? <Link href={event.source_href} className="text-sky-300 hover:text-sky-200">Open source</Link> : null}
                        {event.maintenance_work_item_id ? <Link href={`/${data.workspaceSlug}/work-items/${event.maintenance_work_item_id}`} className="text-sky-300 hover:text-sky-200">Open Maintenance work</Link> : null}
                        {relationshipId ? <Link href={`/${data.workspaceSlug}/relationships/${relationshipId}`} className="text-sky-300 hover:text-sky-200">Open relationship</Link> : null}
                        {sessionId && relationshipId ? <Link href={`/${data.workspaceSlug}/onboarding/${relationshipId}`} className="text-sky-300 hover:text-sky-200">Open onboarding session</Link> : null}
                        {moduleId ? <Link href={`/${data.workspaceSlug}/onboarding-builder?module=${moduleId}`} className="text-sky-300 hover:text-sky-200">Open module</Link> : null}
                        {serviceId ? <Link href={`/${data.workspaceSlug}/settings?section=services&service=${serviceId}`} className="text-sky-300 hover:text-sky-200">Open service</Link> : null}
                    </div>
                </DetailField>
            </DetailFields>

            <div className="mt-5 grid gap-5 lg:grid-cols-2">
                <section className="rounded-2xl border border-neutral-800 bg-black p-5">
                    <h2 className="text-lg font-semibold">Changed fields and references</h2>
                    {metadataEntries.length ? <dl className="mt-4 divide-y divide-neutral-900 rounded-xl border border-neutral-900">
                        {metadataEntries.map(([key, value]) => <div key={key} className="grid gap-1 px-3 py-3 sm:grid-cols-[180px_minmax(0,1fr)]"><dt className="text-sm text-neutral-500">{readableKey(key)}</dt><dd className="break-words whitespace-pre-wrap font-mono text-xs leading-5 text-neutral-300">{readableValue(value)}</dd></div>)}
                    </dl> : <p className="mt-3 text-sm text-neutral-500">No changed-field metadata was recorded.</p>}
                </section>
                <section className="rounded-2xl border border-neutral-800 bg-black p-5">
                    <h2 className="text-lg font-semibold">Sanitized diagnostics</h2>
                    <div className="mt-4"><DetailGrid values={[
                        { label: "Error code", value: errorCode, mono: true },
                        { label: "Failure fingerprint", value: event.failure_fingerprint, mono: true },
                        { label: "Automation stage", value: automationStage },
                        { label: "Provider response", value: providerSummary },
                    ]} /></div>
                    {diagnosticEntries.length ? <pre className="mt-4 max-h-96 overflow-auto rounded-xl border border-neutral-900 bg-neutral-950 p-4 text-xs leading-5 text-neutral-300">{JSON.stringify(diagnostics, null, 2)}</pre> : <p className="mt-3 text-sm text-neutral-500">No diagnostic payload was recorded.</p>}
                </section>
            </div>

            <List ariaLabel="Correlated activity timeline">
                {timeline.map((item) => {
                    const itemStatus = eventStatus(item.level)
                    return <ListItem key={item.id} className={item.id === event.id ? "bg-sky-950/[0.12]" : ""}>
                        <ListPrimaryRow>
                            <ListTitle href={`/${data.workspaceSlug}/admin/activity/${item.id}`} className="flex-1">{item.summary}</ListTitle>
                            <SquarePill>{adminActivityCategoryLabel(item.category)}</SquarePill>
                            <Status label={itemStatus.label} tone={itemStatus.tone} />
                        </ListPrimaryRow>
                        <ListSecondaryRow>
                            <span className="min-w-0 flex-1 truncate font-mono text-xs text-neutral-500">{item.event_key}</span>
                            <ListTrailing><span className="font-mono text-neutral-600">{shortId(item.id)}</span><span className="text-neutral-500">{formatRelativeTime(item.occurred_at)}</span></ListTrailing>
                        </ListSecondaryRow>
                    </ListItem>
                })}
            </List>

            <DetailDangerZone>
                <DetailDangerAction title="Archive activity event" description="Audit-event archival is disabled until the shared archive lifecycle defines how retained diagnostics remain discoverable." control={<DetailDangerButton type="button" disabled>Archive event</DetailDangerButton>} />
                <DetailDangerAction title="Delete activity event permanently" description="Permanent deletion is disabled because audit-retention and dependent-record safeguards have not yet been defined." control={<DetailDangerButton type="button" tone="delete" disabled>Delete permanently</DetailDangerButton>} />
            </DetailDangerZone>
        </div>
    </main>
}

export default function NativeAdminPanel({ data }: { data: NativeAdminSnapshot }) {
    const router = useRouter()
    const pathname = usePathname()
    const search = useSearchParams()
    useEffect(() => {
        if (data.kind === "admin-okrs" && data.focusId && pathname.endsWith(`/${data.focusId}`)) router.replace(`/${data.workspaceSlug}/admin/okrs#okr-${data.focusId}`)
        if (data.kind === "admin-work" && search.get("view") === "okrs") {
            const query = new URLSearchParams(search.toString())
            query.delete("view")
            router.replace(`/${data.workspaceSlug}/admin/okrs${query.size ? `?${query}` : ""}`)
        }
    }, [data, pathname, router, search])
    switch (data.kind) {
        case "admin-work": return <AdminWork data={data} />
        case "admin-okrs": return <AdminOkrs data={data} />
        case "admin-maintenance": return <AdminMaintenance data={data} />
        case "admin-activity": return <AdminActivity data={data} />
        case "admin-activity-detail": return <AdminActivityDetail data={data} />
    }
}
