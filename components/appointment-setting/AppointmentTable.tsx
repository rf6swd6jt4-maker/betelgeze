"use client"

import { useOnline } from "@/components/pwa/useOnline"

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react"
import Link from "next/link"
import { List, ListItem, ListPrimaryRow, ListSecondaryRow, ListTitle, ListTrailing } from "@/components/list/List"
import { ListActionMenu, type ListAction } from "@/components/list/ListActionMenu"
import { MobileListActionSurface } from "@/components/list/MobileCardActionSurface"
import { FilterRail, FilterRailButton, FilterRailCount } from "@/components/panel/FilterRail"
import { Status } from "@/components/ui"
import { appointmentNotificationLabel, type AppointmentDeliveryState } from "@/lib/appointment-setting-delivery"
import { APPOINTMENT_FIELD_OPTIONS, APPOINTMENT_MEDIUM_OPTIONS, appointmentFieldValue, appointmentReadiness, appointmentView, appointmentWithChanges, sortAppointmentWork, type AppointmentSettingAppointment, type AppointmentSettingConfiguration, type AppointmentUpdateField, type AppointmentView } from "@/lib/appointment-setting"
import { fetchAppointmentSettingSnapshot, AppointmentRefreshPolicy, type AppointmentSettingSnapshot } from "@/lib/appointment-setting-refresh"
import { useWorkspaceTabActive, WORKSPACE_TAB_VISIBILITY_EVENT } from "@/components/workspace/useWorkspaceTabActive"
import { AppointmentDraftQueue, type PersistedAppointmentDraft } from "@/lib/appointment-draft-queue"
import { createSupabaseBrowserClient } from "@/lib/supabase/browser"
import { registerWorkspaceAutosaveFlusher, runWorkspaceMutation } from "@/lib/workspace-mutations"
import { formatRelativeTime, shortId } from "@/lib/ui/relative-time"
import { createAppointmentSettingDraft, deleteAppointmentSettingAppointment, saveAppointmentSettingDraft, submitAppointmentSettingAppointment } from "@/app/[workspaceSlug]/appointment-setting/[relationshipId]/actions"
import { AppointmentDraftEditor, AppointmentTimezoneSelect, appointmentInputClass, appointmentScheduleLabel, type DraftQueue } from "./AppointmentDraftEditor"

const subscribeTimezone = () => () => {}
const readTimezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
const serverTimezone = () => ""

type Props = {
    currentUserId: string
    workspaceId: string
    workspaceSlug: string
    relationshipId: string
    serviceId: string
    initialAppointments: AppointmentSettingAppointment[]
    configuration: AppointmentSettingConfiguration
    initialDelivery: AppointmentDeliveryState
    initialNow: number
}

function AppointmentRow({ currentUserId, appointment, configuration, workspaceSlug, relationshipId, delivery, expanded, visible, autoFocus, localTimezone, queues, onOpen, onSaved, onRemove, onRefresh, onDelivery }: {
    currentUserId: string
    appointment: AppointmentSettingAppointment
    configuration: AppointmentSettingConfiguration
    workspaceSlug: string
    relationshipId: string
    delivery: AppointmentDeliveryState
    expanded: boolean
    visible: boolean
    autoFocus: boolean
    localTimezone: string
    queues: Map<string, DraftQueue>
    onOpen: () => void
    onSaved: (row: AppointmentSettingAppointment) => void
    onRemove: (id: string) => Promise<void>
    onRefresh: () => Promise<AppointmentSettingSnapshot | undefined>
    onDelivery: (messageId: string, status: AppointmentDeliveryState["notifications"][string]) => void
}) {
    const [queue] = useState(() => new AppointmentDraftQueue<AppointmentSettingAppointment, AppointmentUpdateField>(appointment, async (row, changes) => {
        if (!navigator.onLine) return { ok: false, error: "Saved on this device. Changes will retry when connected." }
        const result = await runWorkspaceMutation(() => saveAppointmentSettingDraft(workspaceSlug, relationshipId, row.id, changes, row.updated_at), { category: "system" })
        if (result.ok && result.data) onSaved(result.data)
        return result
    }))
    const online = useOnline()
    useEffect(() => {
        const key = `betelgeze:appointment-draft:${currentUserId}:${workspaceSlug}:${relationshipId}:${appointment.id}`
        queue.attachStorage({
            read: () => {
                const value = JSON.parse(localStorage.getItem(key) ?? "null") as PersistedAppointmentDraft<AppointmentUpdateField> | null
                if (!value || typeof value.version !== "string" || !value.changes || typeof value.changes !== "object") return null
                value.changes = Object.fromEntries(Object.entries(value.changes).filter(([, entry]) => typeof entry === "string"))
                return value
            },
            write: (value) => { if (value) localStorage.setItem(key, JSON.stringify(value)); else localStorage.removeItem(key) },
        })
    }, [currentUserId, workspaceSlug, relationshipId, appointment.id, queue])
    const snapshot = useSyncExternalStore(queue.subscribe, queue.getSnapshot, queue.getSnapshot)
    const [submitting, setSubmitting] = useState(false)
    const [submitError, setSubmitError] = useState<string | null>(null)
    const submittingRef = useRef(false)
    useEffect(() => { queue.receive(appointment) }, [appointment, queue])
    useEffect(() => {
        queues.set(appointment.id, queue)
        const unregister = registerWorkspaceAutosaveFlusher(async () => { await queue.flush() })
        return () => { queues.delete(appointment.id); unregister(); void queue.flush() }
    }, [appointment.id, queue, queues])
    useEffect(() => {
        const retry = () => { if (queue.getSnapshot().error && !queue.getSnapshot().conflict) void queue.retry() }
        const recover = () => { if (navigator.onLine && document.visibilityState === "visible") retry() }
        window.addEventListener("online", recover)
        window.addEventListener("focus", recover)
        document.addEventListener("visibilitychange", recover)
        return () => { window.removeEventListener("online", recover); window.removeEventListener("focus", recover); document.removeEventListener("visibilitychange", recover) }
    }, [queue])
    const row = appointmentWithChanges(snapshot.record, snapshot.changes)
    const draft = snapshot.record.workflow_status === "draft"
    const dirty = Object.keys(snapshot.changes).length > 0
    const name = row.contact_name?.trim() || "Untitled lead"
    const communicationsHref = `/${workspaceSlug}/communications?conversation=${encodeURIComponent(relationshipId)}`
    const notification = row.submission_message_id ? delivery.notifications[row.submission_message_id] : undefined
    const editorId = `appointment-editor-${row.id}`
    const actions: ListAction[] = [
        { label: expanded ? "Close appointment" : draft ? "Open draft" : "Open appointment", action: onOpen },
        ...(row.phone ? [{ label: "Copy phone number", copyText: row.phone }] : []),
        ...(draft ? [{ label: "Remove draft", danger: true, confirmMessage: `Remove the draft for ${name}? Any unsaved changes will also be removed.`, action: remove }] : []),
    ]
    async function remove() {
        if (!online) throw new Error("Connect before removing this draft.")
        if (submittingRef.current) throw new Error("Wait for the current appointment action to finish.")
        submittingRef.current = true
        setSubmitting(true)
        try {
            await queue.flush()
            await onRemove(row.id)
        } finally { submittingRef.current = false; setSubmitting(false) }
    }

    async function submit() {
        if (!online) { setSubmitError("Connect before submitting. Your draft is saved on this device."); return }
        if (submittingRef.current) return
        submittingRef.current = true
        setSubmitting(true)
        setSubmitError(null)
        try {
            if (!await queue.flush()) return
            const saved = queue.getSnapshot().record
            const issues = appointmentReadiness(saved, configuration)
            if (issues.length) { setSubmitError(issues[0].message); return }
            const result = await runWorkspaceMutation(() => submitAppointmentSettingAppointment(workspaceSlug, relationshipId, saved.id, saved.updated_at), { category: "system" })
            if (!result.ok || !result.data) {
                setSubmitError(result.ok ? "Submission could not be confirmed. Refresh before trying again." : result.error)
                await onRefresh()
                return
            }
            queue.receive(result.data.appointment)
            onSaved(result.data.appointment)
            if (result.data.appointment.submission_message_id) onDelivery(result.data.appointment.submission_message_id, result.data.notificationStatus)
            void onRefresh()
        } catch (error) {
            setSubmitError(error instanceof Error ? error.message : "Submission could not be confirmed. Check the latest appointment before trying again.")
            // The transaction may have succeeded even if its response was lost.
            void onRefresh()
        } finally {
            submittingRef.current = false
            setSubmitting(false)
        }
    }

    return <ListItem className={!visible ? "hidden" : ""}>
        <MobileListActionSurface actions={actions} label={`Actions for ${name}`}>
            <ListPrimaryRow>
                <button type="button" onClick={onOpen} aria-expanded={expanded} aria-controls={editorId} className="min-w-0 flex-1 text-left focus-visible:outline-2 focus-visible:outline-offset-2">
                    <ListTitle>{name}</ListTitle>
                </button>
                {draft ? <Status label="Draft" tone="yellow" className="ml-auto" /> : <Status label="Submitted" tone="green" className="ml-auto" />}
            </ListPrimaryRow>
            <ListSecondaryRow>
                <span className="min-w-0 truncate text-neutral-300" title={appointmentScheduleLabel(row)}>{appointmentScheduleLabel(row)}</span>
                <span className="hidden shrink-0 text-neutral-500 xl:inline">{APPOINTMENT_MEDIUM_OPTIONS.find((option) => option.key === row.meeting_medium)?.label}</span>
                <span className="hidden min-w-0 truncate text-xs text-neutral-400 md:inline">{draft ? snapshot.error ? "Changes not saved" : snapshot.saving || dirty ? "Saving…" : "Saved" : appointmentNotificationLabel(notification)}</span>
                <ListTrailing>
                    <span className="font-mono text-xs text-neutral-600">{shortId(row.id)}</span>
                    <span className="hidden text-xs text-neutral-500 sm:inline">{formatRelativeTime(row.updated_at)}</span>
                    <ListActionMenu label={`Actions for ${name}`} actions={actions} className="hidden sm:block" />
                </ListTrailing>
            </ListSecondaryRow>
        </MobileListActionSurface>
        <div id={editorId} hidden={!expanded}>
            {expanded && (draft || dirty ? <AppointmentDraftEditor queue={queue} snapshot={snapshot} configuration={configuration} messagingError={delivery.messagingError} communicationsHref={communicationsHref} localTimezone={localTimezone} submitting={submitting} autoFocus={autoFocus && expanded} onSubmit={submit} onReview={async () => (await onRefresh())?.appointments.find((candidate) => candidate.id === row.id)} /> : <div className="space-y-4 px-3.5 py-4 sm:px-4">
                <p className="text-sm text-neutral-200">{appointmentScheduleLabel(row)} <span className="text-neutral-500">({row.appointment_timezone.replaceAll("_", " ")})</span></p>
                <dl className="grid gap-3 text-sm sm:grid-cols-2">
                    {configuration.fields.map((field) => {
                        const value = appointmentFieldValue(row, `detail:${field.key}`)
                        return value ? <div key={field.key} className={field.key === "notes" ? "sm:col-span-2" : ""}><dt className="text-xs text-neutral-500">{APPOINTMENT_FIELD_OPTIONS.find((option) => option.key === field.key)?.label}</dt><dd className="mt-1 whitespace-pre-wrap break-words text-neutral-200">{field.key === "phone" ? <a href={`tel:${value}`} className="underline underline-offset-4">{value}</a> : field.key === "email" ? <a href={`mailto:${value}`} className="underline underline-offset-4">{value}</a> : value}</dd></div> : null
                    })}
                    {row.meeting_medium !== "phone" && row.meeting_link ? <div className="sm:col-span-2"><dt className="text-xs text-neutral-500">Meeting link</dt><dd className="mt-1 break-all"><a href={row.meeting_link} target="_blank" rel="noreferrer" className="text-sm underline underline-offset-4">{row.meeting_link}</a></dd></div> : null}
                </dl>
                <div className="border-t border-neutral-800 pt-3">
                    <p role="status" className={`text-sm ${notification === "sent" ? "text-neutral-200" : "text-amber-300"}`}>{appointmentNotificationLabel(notification)}</p>
                    <Link href={communicationsHref} className="mt-1 inline-flex min-h-9 items-center text-sm text-neutral-300 underline underline-offset-4">Open client conversation</Link>
                    <p className="text-xs text-neutral-500">Submitted appointments are locked for editing.</p>
                </div>
            </div>)}
            {submitError ? <p role="alert" className="px-4 pb-4 text-sm text-red-300">{submitError}</p> : null}
        </div>
    </ListItem>
}

export function AppointmentTable({ currentUserId, workspaceId, workspaceSlug, relationshipId, serviceId, initialAppointments, configuration, initialDelivery, initialNow }: Props) {
    const online = useOnline()
    const tabActive = useWorkspaceTabActive()
    const tabActiveRef = useRef(tabActive)
    useEffect(() => { tabActiveRef.current = tabActive }, [tabActive])
    const [refreshPolicy] = useState(() => new AppointmentRefreshPolicy(initialNow))
    const refreshAbort = useRef<AbortController | null>(null)
    const [appointments, setAppointments] = useState(initialAppointments)
    const [delivery, setDelivery] = useState(initialDelivery)
    const [view, setView] = useState<AppointmentView>(initialAppointments.some((row) => row.workflow_status === "draft") ? "drafts" : "upcoming")
    const [search, setSearch] = useState("")
    const [expandedId, setExpandedId] = useState<string | null>(null)
    const [newDraftId, setNewDraftId] = useState<string | null>(null)
    const [creating, setCreating] = useState(false)
    const [chooseTimezone, setChooseTimezone] = useState(false)
    const [timezone, setTimezone] = useState("")
    const localTimezone = useSyncExternalStore(subscribeTimezone, readTimezone, serverTimezone)
    const [error, setError] = useState<string | null>(null)
    const [now, setNow] = useState(initialNow)
    const [queues] = useState(() => new Map<string, DraftQueue>())
    const refreshRequest = useRef<Promise<AppointmentSettingSnapshot> | null>(null)
    const mutationVersion = useRef(0)
    const mutationCount = useRef(0)
    const active = useRef(true)
    const creatingRef = useRef(false)
    const onSaved = useCallback((row: AppointmentSettingAppointment) => {
        mutationVersion.current += 1
        setAppointments((current) => current.map((candidate) => candidate.id === row.id ? row : candidate))
    }, [])
    const refresh = useCallback(async () => {
        if (!navigator.onLine || mutationCount.current) return undefined
        if (refreshRequest.current) return refreshRequest.current.catch(() => undefined)
        const version = mutationVersion.current
        const revision = refreshPolicy.capture()
        const controller = new AbortController()
        refreshAbort.current = controller
        const timeout = setTimeout(() => controller.abort("timeout"), 15_000)
        const request = fetchAppointmentSettingSnapshot(workspaceSlug, relationshipId, controller.signal)
        refreshRequest.current = request
        try {
            const result = await request
            if (active.current && version === mutationVersion.current && !mutationCount.current) {
                setAppointments((current) => {
                    const received = new Set(result.appointments.map((row) => row.id))
                    const preserved = current.filter((row) => {
                        const queue = queues.get(row.id)
                        return !received.has(row.id) && queue && (queue.getSnapshot().saving || Object.keys(queue.getSnapshot().changes).length > 0)
                    })
                    return [...result.appointments, ...preserved]
                })
                for (const [id, queue] of queues) {
                    const row = result.appointments.find((candidate) => candidate.id === id)
                    if (row) queue.receive(row)
                    else if (Object.keys(queue.getSnapshot().changes).length && !queue.getSnapshot().saving) queue.markUnavailable()
                }
                refreshPolicy.completed(revision, Date.now())
                setDelivery(result.delivery)
                setError(null)
                setNow(Date.now())
            }
            return result
        } catch {
            if (active.current && (!controller.signal.aborted || controller.signal.reason === "timeout")) setError("Could not refresh appointments. Your open draft changes are preserved.")
            return undefined
        } finally {
            clearTimeout(timeout)
            if (refreshRequest.current === request) refreshRequest.current = null
            if (refreshAbort.current === controller) refreshAbort.current = null
        }
    }, [queues, refreshPolicy, relationshipId, workspaceSlug])

    useEffect(() => {
        active.current = true
        const supabase = createSupabaseBrowserClient()
        let timer: ReturnType<typeof setTimeout> | undefined
        let navigating = false
        const visible = () => !navigating && tabActiveRef.current && document.visibilityState === "visible"
        const schedule = () => {
            clearTimeout(timer)
            timer = setTimeout(async () => {
                if (!refreshPolicy.needsRefresh(Date.now(), visible())) return
                const revision = refreshPolicy.capture()
                const result = await refresh()
                // An event received during the request must get its own snapshot.
                if (result && revision !== refreshPolicy.capture()) schedule()
            }, 250)
        }
        const invalidate = () => { refreshPolicy.invalidate(); schedule() }
        const pauseForNavigation = () => { navigating = true; clearTimeout(timer); refreshAbort.current?.abort() }
        window.addEventListener("focus", schedule)
        window.addEventListener("online", invalidate)
        window.addEventListener(WORKSPACE_TAB_VISIBILITY_EVENT, schedule)
        document.addEventListener("visibilitychange", schedule)
        window.addEventListener("betelgeze:workspace-navigation-start", pauseForNavigation)
        const channel = supabase.channel(`appointment-setting:${workspaceId}:${relationshipId}:${serviceId}`)
            .on("postgres_changes", { event: "*", schema: "public", table: "appointment_setting_appointments", filter: `relationship_id=eq.${relationshipId}` }, invalidate)
            .on("postgres_changes", { event: "UPDATE", schema: "public", table: "client_messages", filter: `relationship_id=eq.${relationshipId}` }, invalidate)
            .subscribe((status) => { if (status === "SUBSCRIBED") invalidate() })
        const interval = setInterval(() => { if (visible()) { setNow(Date.now()); schedule() } }, 60_000)
        return () => {
            active.current = false
            navigating = true
            clearTimeout(timer)
            clearInterval(interval)
            refreshAbort.current?.abort()
            window.removeEventListener("focus", schedule)
            window.removeEventListener("online", invalidate)
            window.removeEventListener(WORKSPACE_TAB_VISIBILITY_EVENT, schedule)
            document.removeEventListener("visibilitychange", schedule)
            window.removeEventListener("betelgeze:workspace-navigation-start", pauseForNavigation)
            void supabase.removeChannel(channel)
        }
    }, [refresh, refreshPolicy, relationshipId, serviceId, workspaceId])
    useEffect(() => {
        const warn = (event: BeforeUnloadEvent) => {
            if ([...queues.values()].some((queue) => queue.getSnapshot().saving || Object.keys(queue.getSnapshot().changes).length)) { event.preventDefault(); event.returnValue = "" }
        }
        window.addEventListener("beforeunload", warn)
        return () => window.removeEventListener("beforeunload", warn)
    }, [queues])

    async function addDraft() {
        if (!timezone) { setChooseTimezone(true); return }
        if (creatingRef.current) return
        creatingRef.current = true
        mutationCount.current += 1
        mutationVersion.current += 1
        setCreating(true)
        setError(null)
        try {
            const result = await runWorkspaceMutation(() => createAppointmentSettingDraft(workspaceSlug, relationshipId, timezone), { category: "system" })
            if (!result.ok || !result.data) { setError(result.ok ? "Could not create a draft." : result.error); return }
            const row = result.data
            setAppointments((current) => [...current.filter((candidate) => candidate.id !== row.id), row])
            setExpandedId(row.id)
            setNewDraftId(row.id)
            setView("drafts")
            setSearch("")
            setChooseTimezone(false)
        } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not create a draft.") }
        finally { creatingRef.current = false; mutationCount.current -= 1; mutationVersion.current += 1; setCreating(false) }
    }
    async function removeDraft(id: string) {
        mutationCount.current += 1
        mutationVersion.current += 1
        try {
            const result = await deleteAppointmentSettingAppointment(workspaceSlug, relationshipId, id)
            if (!result.ok) throw new Error(result.error)
            setAppointments((current) => current.filter((row) => row.id !== id))
            setExpandedId((current) => current === id ? null : current)
        } finally { mutationCount.current -= 1; mutationVersion.current += 1 }
    }
    const query = search.trim().toLowerCase()
    const digits = query.replace(/\D/g, "")
    const matches = (row: AppointmentSettingAppointment) => appointmentView(row, now) === view && (!query || row.contact_name?.toLowerCase().includes(query) || row.phone?.toLowerCase().includes(query) || (digits.length >= 3 && row.phone?.replace(/\D/g, "").includes(digits)))
    const visibleCount = appointments.filter((row) => matches(row) || row.id === expandedId).length
    const communicationsHref = `/${workspaceSlug}/communications?conversation=${encodeURIComponent(relationshipId)}`
    return <section data-workspace-mutation-scope="local" className="mt-5" aria-label="Appointments">
        <div className="flex flex-wrap items-center justify-between gap-3">
            <label className="min-w-0 flex-1 sm:max-w-sm"><span className="sr-only">Search appointments by name or phone</span><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name or phone" className={appointmentInputClass} /></label>
            <button type="button" disabled={creating || !online} onClick={() => void addDraft()} className="min-h-11 shrink-0 rounded-md border border-neutral-700 px-3 text-sm text-neutral-200 hover:border-neutral-500 disabled:opacity-50">{creating ? "Adding…" : "+ Add draft"}</button>
        </div>
        {chooseTimezone ? <form onSubmit={(event) => { event.preventDefault(); void addDraft() }} className="mt-4 space-y-3 border-y border-neutral-800 py-4">
            <div className="sm:max-w-md"><label htmlFor="new-appointment-timezone" className="mb-2 block text-sm text-neutral-200">Which timezone is this appointment in?</label><AppointmentTimezoneSelect id="new-appointment-timezone" value={timezone} onChange={setTimezone} disabled={creating || !online} /><p className="mt-1 text-xs text-neutral-400">Use the client’s appointment timezone. You can change it in the draft.</p></div>
            <div className="flex gap-3"><button type="submit" disabled={!timezone || creating} className="min-h-11 rounded-md bg-white px-3 text-sm text-black disabled:opacity-50">{creating ? "Adding…" : "Create draft"}</button><button type="button" onClick={() => setChooseTimezone(false)} className="min-h-11 px-2 text-sm text-neutral-400">Cancel</button></div>
        </form> : null}
        {error ? <p role="alert" className="mt-3 text-sm text-red-300">{error} <button type="button" onClick={() => void refresh()} className="underline underline-offset-4">Refresh</button></p> : null}
        {delivery.messagingError || delivery.notificationError ? <p role="status" className="mt-3 text-sm text-amber-300">{delivery.messagingError || delivery.notificationError} <Link href={communicationsHref} className="underline underline-offset-4">Open Communications</Link></p> : null}
        <FilterRail ariaLabel="Appointment view">{(["drafts", "upcoming", "past"] as const).map((category) => <FilterRailButton key={category} selected={view === category} onClick={() => { setView(category); setExpandedId(null) }}>{category === "drafts" ? "Drafts" : category === "upcoming" ? "Upcoming" : "Past"}<FilterRailCount>{appointments.filter((row) => appointmentView(row, now) === category).length}</FilterRailCount></FilterRailButton>)}</FilterRail>
        {expandedId && appointments.some((row) => row.id === expandedId && !matches(row)) ? <p className="mt-3 text-xs text-neutral-400">Your selected appointment stays visible until you close it or change views.</p> : null}
        <List ariaLabel="Appointments">
            {sortAppointmentWork(appointments, now).map((row) => <AppointmentRow currentUserId={currentUserId} key={row.id} appointment={row} configuration={configuration} workspaceSlug={workspaceSlug} relationshipId={relationshipId} delivery={delivery} expanded={expandedId === row.id} visible={matches(row) || expandedId === row.id} autoFocus={newDraftId === row.id} localTimezone={localTimezone} queues={queues} onOpen={() => { setExpandedId((current) => current === row.id ? null : row.id); setNewDraftId(null) }} onSaved={onSaved} onRemove={removeDraft} onRefresh={refresh} onDelivery={(messageId, status) => { mutationVersion.current += 1; setDelivery((current) => ({ ...current, notifications: { ...current.notifications, [messageId]: status } })) }} />)}
            {!visibleCount ? <p className="px-4 py-8 text-center text-sm text-neutral-500">{query ? "No appointments match your search." : view === "drafts" ? "No drafts. Add one when you start working a lead." : view === "upcoming" ? "No upcoming appointments." : "No past appointments."}</p> : null}
        </List>
    </section>
}
