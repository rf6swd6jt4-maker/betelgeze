"use client"

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react"
import { ListActionMenu } from "@/components/list/ListActionMenu"
import { appointmentNotificationNotice } from "@/lib/appointment-setting-delivery"
import { Status } from "@/components/ui"
import {
    APPOINTMENT_FIELD_OPTIONS,
    APPOINTMENT_MEDIUM_OPTIONS,
    type AppointmentFieldKey,
    type AppointmentSettingAppointment,
    type AppointmentSettingConfiguration,
} from "@/lib/appointment-setting"
import { createSupabaseBrowserClient } from "@/lib/supabase/browser"
import { runWorkspaceMutation, type WorkspaceMutationResult } from "@/lib/workspace-mutations"
import {
    createAppointmentSettingDraft,
    deleteAppointmentSettingAppointment,
    submitAppointmentSettingAppointment,
    updateAppointmentSettingAppointment,
    type AppointmentUpdateField,
} from "@/app/[workspaceSlug]/appointment-setting/[relationshipId]/actions"

type Props = {
    workspaceId: string
    workspaceSlug: string
    relationshipId: string
    serviceId: string
    initialAppointments: AppointmentSettingAppointment[]
    configuration: AppointmentSettingConfiguration
}

const APPOINTMENT_SELECT = "id, workspace_id, relationship_id, service_id, contact_name, phone, appointment_at, appointment_date, appointment_time, appointment_timezone, meeting_medium, meeting_link, details, workflow_status, submitted_at, submitted_by, submission_message_id, created_by, updated_by, created_at, updated_at"
const inputClass = "h-9 w-full rounded-md border border-neutral-700 bg-black px-2.5 text-sm text-white outline-none transition placeholder:text-neutral-700 focus:border-neutral-400 disabled:opacity-60"

function browserTimezone() {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
}

function shortTime(value: string | null) {
    return value?.slice(0, 5) ?? ""
}

function dateLabel(value: string | null, timeZone: string, fallback: string | null) {
    if (!value) return fallback ?? "—"
    try {
        return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone }).format(new Date(value))
    } catch {
        return fallback ?? "—"
    }
}

function timeLabel(value: string | null, timeZone: string, fallback: string | null) {
    if (!value) return fallback ? `${shortTime(fallback)} (${timeZone})` : "—"
    try {
        return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone, timeZoneName: "short" }).format(new Date(value))
    } catch {
        return fallback ? `${shortTime(fallback)} (${timeZone})` : "—"
    }
}

function sortAppointments(rows: AppointmentSettingAppointment[]) {
    return [...rows].sort((left, right) => {
        if (left.workflow_status !== right.workflow_status) return left.workflow_status === "draft" ? -1 : 1
        if (left.workflow_status === "draft") return right.created_at.localeCompare(left.created_at)
        return (left.appointment_at ?? "").localeCompare(right.appointment_at ?? "") || left.created_at.localeCompare(right.created_at)
    })
}

function detailValue(row: AppointmentSettingAppointment, key: AppointmentFieldKey) {
    return key === "phone" ? row.phone ?? "" : String(row.details?.[key] ?? "")
}

function EditableCell({ label, value, displayValue, type = "text", pending, initialEditing = false, onSave }: {
    label: string
    value: string
    displayValue: string
    type?: "text" | "tel" | "email" | "url" | "date" | "time"
    pending: boolean
    initialEditing?: boolean
    onSave: (value: string) => Promise<boolean>
}) {
    const [editing, setEditing] = useState(initialEditing)
    const [draft, setDraft] = useState(value)
    const committing = useRef(false)
    const cancelled = useRef(false)

    async function commit() {
        if (committing.current || cancelled.current) return
        const cleaned = draft.trim()
        if (cleaned === value) {
            setEditing(false)
            return
        }
        committing.current = true
        const saved = await onSave(cleaned)
        committing.current = false
        if (saved) setEditing(false)
    }

    function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
        if (event.key === "Escape") {
            event.preventDefault()
            cancelled.current = true
            setDraft(value)
            setEditing(false)
        }
        if (event.key === "Enter") {
            event.preventDefault()
            void commit()
        }
    }

    if (editing) {
        return <input type={type} aria-label={label} autoFocus disabled={pending} value={draft} onChange={(event) => setDraft(event.target.value)} onBlur={() => void commit()} onKeyDown={handleKeyDown} className={inputClass} />
    }
    return <button type="button" aria-label={`Edit ${label}`} disabled={pending} onClick={() => { cancelled.current = false; setDraft(value); setEditing(true) }} className="block max-w-full truncate rounded px-1 py-1 text-left text-sm text-neutral-200 underline decoration-dotted decoration-neutral-700 underline-offset-4 transition hover:bg-neutral-900 hover:text-white focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/70 disabled:opacity-60">{displayValue || "—"}</button>
}

function EditableSelect({ label, value, options, pending, onSave }: {
    label: string
    value: string
    options: Array<{ value: string; label: string }>
    pending: boolean
    onSave: (value: string) => Promise<boolean>
}) {
    return <select aria-label={label} value={value} disabled={pending} onChange={(event) => void onSave(event.target.value)} className={`${inputClass} border-transparent bg-transparent px-1 underline decoration-dotted decoration-neutral-700 underline-offset-4 hover:bg-neutral-900 focus:bg-black`}>
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
}

function ReadOnlyCell({ children }: { children: string }) {
    return <span className="block max-w-full truncate px-1 text-sm text-neutral-300">{children || "—"}</span>
}

export function AppointmentTable({ workspaceId, workspaceSlug, relationshipId, serviceId, initialAppointments, configuration }: Props) {
    const [appointments, setAppointments] = useState(() => sortAppointments(initialAppointments))
    const [savingKey, setSavingKey] = useState<string | null>(null)
    const mutationPending = useRef(false)
    const refreshVersion = useRef(0)
    const refreshRef = useRef<() => Promise<void>>(async () => {})
    const [newDraftId, setNewDraftId] = useState<string | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [notice, setNotice] = useState<{ tone: "success" | "warning"; message: string } | null>(null)
    const hasRemoteMedium = configuration.mediums.some((medium) => medium !== "phone")
    const columns = useMemo(() => [
        "minmax(12rem,1fr)",
        ...configuration.fields.map(() => "minmax(11rem,.8fr)"),
        "minmax(9.5rem,.65fr)",
        "minmax(8.5rem,.55fr)",
        "minmax(9rem,.6fr)",
        ...(hasRemoteMedium ? ["minmax(14rem,.9fr)"] : []),
        "minmax(10.5rem,.7fr)",
        "3rem",
    ].join(" "), [configuration.fields, hasRemoteMedium])
    const columnCount = 6 + configuration.fields.length + (hasRemoteMedium ? 1 : 0)

    useEffect(() => {
        const supabase = createSupabaseBrowserClient()
        let refreshTimer: number | null = null
        let active = true
        const refreshAppointments = async () => {
            if (mutationPending.current) return
            const version = ++refreshVersion.current
            const { data, error: refreshError } = await supabase.from("appointment_setting_appointments").select(APPOINTMENT_SELECT).eq("workspace_id", workspaceId).eq("relationship_id", relationshipId).eq("service_id", serviceId).order("created_at", { ascending: false })
            if (active && !mutationPending.current && version === refreshVersion.current && !refreshError) setAppointments(sortAppointments((data ?? []) as AppointmentSettingAppointment[]))
        }
        refreshRef.current = refreshAppointments
        window.addEventListener("focus", refreshAppointments)
        window.addEventListener("online", refreshAppointments)
        const channel = supabase.channel(`appointment-setting:${workspaceId}:${relationshipId}:${serviceId}`).on("postgres_changes", { event: "*", schema: "public", table: "appointment_setting_appointments", filter: `relationship_id=eq.${relationshipId}` }, () => {
            if (refreshTimer !== null) window.clearTimeout(refreshTimer)
            refreshTimer = window.setTimeout(() => void refreshAppointments(), 120)
        }).subscribe((status) => { if (status === "SUBSCRIBED") void refreshAppointments() })
        return () => {
            active = false
            window.removeEventListener("focus", refreshAppointments)
            window.removeEventListener("online", refreshAppointments)
            if (refreshTimer !== null) window.clearTimeout(refreshTimer)
            void supabase.removeChannel(channel)
        }
    }, [relationshipId, serviceId, workspaceId])

    function beginMutation(key: string) {
        if (mutationPending.current) return false
        mutationPending.current = true
        refreshVersion.current += 1
        setSavingKey(key)
        setError(null)
        setNotice(null)
        return true
    }

    function finishMutation() {
        mutationPending.current = false
        setSavingKey(null)
        void refreshRef.current()
    }

    async function saveField(row: AppointmentSettingAppointment, field: AppointmentUpdateField, value: string) {
        const key = `${row.id}:${field}`
        if (!beginMutation(key)) return false
        try {
            const result = await runWorkspaceMutation(() => updateAppointmentSettingAppointment(workspaceSlug, relationshipId, row.id, field, value, row.updated_at), { category: "system" })
            if (!result.ok) {
                setError(result.error)
                return false
            }
            setAppointments((current) => sortAppointments(current.map((candidate) => candidate.id === row.id ? result.data! : candidate)))
            return true
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : "We couldn't save that draft change.")
            return false
        } finally {
            finishMutation()
        }
    }

    async function addDraft() {
        if (!beginMutation("new")) return
        try {
            const result = await runWorkspaceMutation(() => createAppointmentSettingDraft(workspaceSlug, relationshipId, browserTimezone()), { category: "system" })
            if (!result.ok) {
                setError(result.error)
                return
            }
            setNewDraftId(result.data!.id)
            setAppointments((current) => sortAppointments([...current.filter((row) => row.id !== result.data!.id), result.data!]))
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : "We couldn't add an appointment draft.")
        } finally {
            finishMutation()
        }
    }

    async function submitDraft(row: AppointmentSettingAppointment) {
        if (!beginMutation(`${row.id}:submit`)) return
        try {
            const result = await runWorkspaceMutation(() => submitAppointmentSettingAppointment(workspaceSlug, relationshipId, row.id, row.updated_at), { category: "communications" })
            if (!result.ok) {
                setError(result.error)
                return
            }
            setAppointments((current) => sortAppointments(current.map((candidate) => candidate.id === row.id ? result.data!.appointment : candidate)))
            setNotice({
                tone: result.data!.notificationStatus === "sent" ? "success" : "warning",
                message: appointmentNotificationNotice(result.data!.notificationStatus),
            })
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : "We couldn't submit this appointment.")
        } finally {
            finishMutation()
        }
    }

    async function removeDraft(appointmentId: string) {
        if (!beginMutation(`${appointmentId}:delete`)) throw new Error("Wait for the current change to finish.")
        try {
            const result: WorkspaceMutationResult = await deleteAppointmentSettingAppointment(workspaceSlug, relationshipId, appointmentId)
            if (!result.ok) throw new Error(result.error)
            setAppointments((current) => current.filter((row) => row.id !== appointmentId))
        } finally {
            finishMutation()
        }
    }

    const cellClass = "flex min-w-0 items-center border-l border-neutral-900 px-3 first:border-l-0"
    return <section data-workspace-mutation-scope="local" className="mt-5" aria-labelledby="appointments-heading">
        <div className="mb-3 flex items-end justify-between gap-3">
            <div>
                <h2 id="appointments-heading" className="text-sm font-medium text-neutral-200">Appointments</h2>
                <p className="mt-1 text-xs text-neutral-600">Add a draft while you work the lead. Fields save when you leave them. Submit once the appointment is confirmed.</p>
            </div>
            <button type="button" disabled={savingKey !== null} onClick={() => void addDraft()} className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border border-neutral-700 px-3 text-sm text-neutral-200 transition hover:border-neutral-500 hover:text-white disabled:opacity-50">
                <span aria-hidden="true" className="text-base leading-none">+</span>{savingKey === "new" ? "Adding…" : "Add draft"}
            </button>
        </div>
        {error ? <p role="alert" className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">{error}</p> : null}
        {notice ? <p role="status" className={`mb-3 rounded-lg border px-3 py-2 text-sm ${notice.tone === "success" ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200" : "border-amber-500/30 bg-amber-500/10 text-amber-200"}`}>{notice.message}</p> : null}
        {/* This is an inline appointment-entry worksheet: fields are the primary
            controls and there is no appointment detail route. A two-band List
            would hide the editable columns required by the client configuration. */}
        <div className="overflow-x-auto rounded-xl border border-neutral-800 bg-black">
            <div role="table" aria-label="Appointments" aria-rowcount={appointments.length + 1}>
                <div role="row" className="grid h-10 min-w-max border-b border-neutral-800 bg-neutral-950 text-[11px] font-medium uppercase tracking-wide text-neutral-500" style={{ gridTemplateColumns: columns }}>
                    <div role="columnheader" className="flex items-center px-4">Name</div>
                    {configuration.fields.map((field) => <div key={field.key} role="columnheader" className="flex items-center border-l border-neutral-900 px-4">{APPOINTMENT_FIELD_OPTIONS.find((option) => option.key === field.key)?.label}{field.required ? " *" : ""}</div>)}
                    <div role="columnheader" className="flex items-center border-l border-neutral-900 px-4">Date</div>
                    <div role="columnheader" className="flex items-center border-l border-neutral-900 px-4">Time</div>
                    <div role="columnheader" className="flex items-center border-l border-neutral-900 px-4">Medium</div>
                    {hasRemoteMedium ? <div role="columnheader" className="flex items-center border-l border-neutral-900 px-4">Meeting link</div> : null}
                    <div role="columnheader" className="flex items-center border-l border-neutral-900 px-4">Status</div>
                    <div role="columnheader" className="border-l border-neutral-900"><span className="sr-only">Actions</span></div>
                </div>
                {appointments.length ? appointments.map((appointment) => {
                    const name = appointment.contact_name?.trim() || "Untitled lead"
                    const isDraft = appointment.workflow_status === "draft"
                    const rowPending = savingKey !== null
                    return <div key={appointment.id} role="row" className="grid min-h-12 min-w-max border-b border-neutral-900 last:border-b-0 hover:bg-neutral-950" style={{ gridTemplateColumns: columns }}>
                        <div role="cell" className="flex min-w-0 items-center px-3">{isDraft
                            ? <EditableCell label={`name for ${name}`} value={appointment.contact_name ?? ""} displayValue={appointment.contact_name ?? "Add name"} pending={rowPending} initialEditing={newDraftId === appointment.id} onSave={(value) => { setNewDraftId(null); return saveField(appointment, "contact_name", value) }} />
                            : <ReadOnlyCell>{name}</ReadOnlyCell>}</div>
                        {configuration.fields.map((field) => {
                            const option = APPOINTMENT_FIELD_OPTIONS.find((candidate) => candidate.key === field.key)!
                            const value = detailValue(appointment, field.key)
                            return <div key={field.key} role="cell" className={cellClass}>{isDraft
                                ? <EditableCell label={`${option.label} for ${name}`} value={value} displayValue={value || `Add ${option.label.toLowerCase()}`} type={option.inputType === "email" ? "email" : option.inputType === "tel" ? "tel" : "text"} pending={rowPending} onSave={(next) => saveField(appointment, `detail:${field.key}`, next)} />
                                : <ReadOnlyCell>{value}</ReadOnlyCell>}</div>
                        })}
                        <div role="cell" className={cellClass}>{isDraft
                            ? <EditableCell label={`date for ${name}`} value={appointment.appointment_date ?? ""} displayValue={appointment.appointment_date ?? "Add date"} type="date" pending={rowPending} onSave={(value) => saveField(appointment, "appointment_date", value)} />
                            : <ReadOnlyCell>{dateLabel(appointment.appointment_at, appointment.appointment_timezone, appointment.appointment_date)}</ReadOnlyCell>}</div>
                        <div role="cell" className={cellClass}>{isDraft
                            ? <EditableCell label={`time for ${name}`} value={shortTime(appointment.appointment_time)} displayValue={appointment.appointment_time ? `${shortTime(appointment.appointment_time)} (${appointment.appointment_timezone})` : "Add time"} type="time" pending={rowPending} onSave={(value) => saveField(appointment, "appointment_time", value)} />
                            : <ReadOnlyCell>{timeLabel(appointment.appointment_at, appointment.appointment_timezone, appointment.appointment_time)}</ReadOnlyCell>}</div>
                        <div role="cell" className={cellClass}>{isDraft
                            ? <EditableSelect label={`medium for ${name}`} value={appointment.meeting_medium} options={configuration.mediums.map((medium) => ({ value: medium, label: APPOINTMENT_MEDIUM_OPTIONS.find((option) => option.key === medium)?.label ?? medium }))} pending={rowPending} onSave={(value) => saveField(appointment, "meeting_medium", value)} />
                            : <ReadOnlyCell>{APPOINTMENT_MEDIUM_OPTIONS.find((option) => option.key === appointment.meeting_medium)?.label ?? appointment.meeting_medium}</ReadOnlyCell>}</div>
                        {hasRemoteMedium ? <div role="cell" className={cellClass}>{isDraft
                            ? <EditableCell label={`meeting link for ${name}`} value={appointment.meeting_link ?? ""} displayValue={appointment.meeting_link ?? "Add link"} type="url" pending={rowPending} onSave={(value) => saveField(appointment, "meeting_link", value)} />
                            : <ReadOnlyCell>{appointment.meeting_link ?? "—"}</ReadOnlyCell>}</div> : null}
                        <div role="cell" className="flex items-center gap-3 border-l border-neutral-900 px-3">{isDraft
                            ? <><Status label="Draft" tone="yellow" compact /><button type="button" disabled={rowPending} onClick={() => void submitDraft(appointment)} className="inline-flex h-8 items-center rounded-md bg-white px-3 text-xs font-medium text-black transition hover:bg-neutral-200 disabled:opacity-50">{savingKey === `${appointment.id}:submit` ? "Submitting…" : "Submit"}</button></>
                            : <Status label="Submitted" tone="green" />}</div>
                        <div role="cell" className="flex items-center justify-center border-l border-neutral-900">{isDraft ? <ListActionMenu label={`Actions for ${name}`} actions={[{ label: "Remove draft", action: () => removeDraft(appointment.id), danger: true, confirmMessage: `Remove the draft for ${name}?` }]} /> : null}</div>
                    </div>
                }) : <div role="row" className="grid h-16 min-w-max" style={{ gridTemplateColumns: columns }}><div role="cell" className="flex items-center justify-center px-4 text-sm text-neutral-600" style={{ gridColumn: `span ${columnCount}` }}>No appointment drafts or submitted appointments yet.</div></div>}
            </div>
        </div>
        <p aria-live="polite" className="mt-2 min-h-4 text-right text-xs text-neutral-600">{savingKey && savingKey !== "new" ? "Saving…" : ""}</p>
    </section>
}
