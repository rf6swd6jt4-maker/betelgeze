"use client"

import { useState, type FormEvent, type ChangeEvent } from "react"
import Link from "next/link"
import { APPOINTMENT_FIELD_OPTIONS, APPOINTMENT_MEDIUM_OPTIONS, appointmentFieldValue, appointmentReadiness, appointmentTimeCandidates, appointmentWithChanges, type AppointmentSettingAppointment, type AppointmentSettingConfiguration, type AppointmentUpdateField } from "@/lib/appointment-setting"
import { AppointmentDraftQueue, type DraftSnapshot } from "@/lib/appointment-draft-queue"

export type DraftQueue = AppointmentDraftQueue<AppointmentSettingAppointment, AppointmentUpdateField>
export const appointmentInputClass = "min-h-11 w-full min-w-0 rounded-md border border-neutral-700 bg-black px-3 py-2 text-sm text-white outline-none placeholder:text-neutral-600 focus:border-neutral-400 focus-visible:ring-1 focus-visible:ring-neutral-400 disabled:opacity-60 [color-scheme:dark]"

export function AppointmentTimezoneSelect({ id, value, onChange, disabled, invalid, describedBy }: { id: string; value: string; onChange: (value: string) => void; disabled?: boolean; invalid?: boolean; describedBy?: string }) {
    const zones = [...new Set(["UTC", "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "Pacific/Honolulu", "America/Anchorage", "Europe/Dublin", ...(value ? [value] : []), ...Intl.supportedValuesOf("timeZone")])]
    return <select id={id} value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled} aria-invalid={invalid || undefined} aria-describedby={describedBy} className={appointmentInputClass}>
        <option value="" disabled>Choose appointment timezone</option>
        {zones.map((zone) => <option key={zone} value={zone}>{zone.replaceAll("_", " ")}</option>)}
    </select>
}

export function appointmentScheduleLabel(row: AppointmentSettingAppointment) {
    const candidates = row.appointment_at ? [Date.parse(row.appointment_at)] : appointmentTimeCandidates(row.appointment_date ?? "", row.appointment_time ?? "", row.appointment_timezone)
    if (candidates.length !== 1 || !Number.isFinite(candidates[0])) return row.appointment_date ? `${row.appointment_date} · ${row.appointment_time?.slice(0, 5) || "Time needed"}` : "Date and time needed"
    return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: row.appointment_timezone, timeZoneName: "short" }).format(candidates[0])
}

export function AppointmentDraftEditor({ queue, snapshot, configuration, messagingError, communicationsHref, localTimezone, submitting, autoFocus, onSubmit, onReview }: {
    queue: DraftQueue
    snapshot: DraftSnapshot<AppointmentSettingAppointment, AppointmentUpdateField>
    configuration: AppointmentSettingConfiguration
    messagingError: string | null
    communicationsHref: string
    localTimezone: string
    submitting: boolean
    autoFocus: boolean
    onSubmit: () => Promise<void>
    onReview: () => Promise<AppointmentSettingAppointment | undefined>
}) {
    const [attempted, setAttempted] = useState(false)
    const [reviewed, setReviewed] = useState<AppointmentSettingAppointment | null>(null)
    const [reviewError, setReviewError] = useState<string | null>(null)
    const row = appointmentWithChanges(snapshot.record, { ...snapshot.changes, ...snapshot.inputValues })
    const issues = appointmentReadiness(row, configuration)
    const dirty = Object.keys(snapshot.changes).length > 0
    const disabled = submitting || snapshot.record.workflow_status !== "draft"
    const id = (field: AppointmentUpdateField) => `appointment-${row.id}-${field.replace(":", "-")}`
    const fieldLabel = (field: AppointmentUpdateField) => (({ contact_name: "Lead name", appointment_date: "Date", appointment_time: "Time", appointment_timezone: "Timezone", meeting_medium: "Meeting type", meeting_link: "Meeting link" } as Record<string, string>)[field] ?? APPOINTMENT_FIELD_OPTIONS.find((option) => `detail:${option.key}` === field)?.label ?? field)
    const fieldError = (field: AppointmentUpdateField) => snapshot.fieldErrors[field] ?? (attempted ? issues.find((issue) => issue.field === field)?.message : undefined)
    const focus = (field: AppointmentUpdateField) => document.getElementById(id(field))?.focus()

    function field(field: AppointmentUpdateField, label: string, type = "text", required = false, multiline = false) {
        const error = fieldError(field)
        const props = { id: id(field), value: appointmentFieldValue(row, field), disabled, required, "aria-invalid": Boolean(error) || undefined, "aria-describedby": error ? `${id(field)}-error` : undefined, onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => queue.edit(field, event.target.value), onFocus: () => queue.focus(field), onBlur: () => { queue.blur(); void queue.flush() }, className: appointmentInputClass }
        return <div key={field} className={multiline ? "sm:col-span-2" : "min-w-0"}>
            <label htmlFor={id(field)} className="mb-1.5 block text-xs text-neutral-400">{label}{required ? " *" : ""}</label>
            {multiline ? <textarea {...props} rows={3} maxLength={1000} /> : <input {...props} type={type} autoFocus={autoFocus && field === "contact_name"} autoComplete="off" />}
            {error ? <p id={`${id(field)}-error`} className="mt-1 text-xs text-red-300">{error}</p> : null}
        </div>
    }

    async function submit(event: FormEvent) {
        event.preventDefault()
        setAttempted(true)
        if (issues.length) { focus(issues[0].field); return }
        await onSubmit()
    }

    const candidates = appointmentTimeCandidates(row.appointment_date ?? "", row.appointment_time ?? "", row.appointment_timezone)
    const localTime = localTimezone && localTimezone !== row.appointment_timezone && candidates.length === 1
        ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: localTimezone, timeZoneName: "short" }).format(candidates[0]) : null
    return <form noValidate onSubmit={(event) => void submit(event)} className="space-y-5 px-3.5 py-4 sm:px-4" aria-label={`Appointment draft for ${row.contact_name || "new lead"}`}>
        <fieldset disabled={disabled}>
            <legend className="mb-3 text-sm font-medium text-neutral-200">Contact details</legend>
            <div className="grid gap-3 sm:grid-cols-2">
                {field("contact_name", "Lead name", "text", true)}
                {configuration.fields.filter((item) => item.key === "phone" || item.key === "email").map((item) => field(`detail:${item.key}`, APPOINTMENT_FIELD_OPTIONS.find((option) => option.key === item.key)!.label, item.key === "phone" ? "tel" : "email", item.required))}
            </div>
        </fieldset>
        <fieldset disabled={disabled}>
            <legend className="mb-3 text-sm font-medium text-neutral-200">Appointment details</legend>
            <div className="grid gap-3 sm:grid-cols-2">
                {field("appointment_date", "Date", "date", true)}
                {field("appointment_time", "Time", "time", true)}
                <div className="min-w-0">
                    <label htmlFor={id("appointment_timezone")} className="mb-1.5 block text-xs text-neutral-400">Appointment timezone *</label>
                    <AppointmentTimezoneSelect id={id("appointment_timezone")} value={row.appointment_timezone} disabled={disabled} invalid={Boolean(fieldError("appointment_timezone"))} describedBy={`${id("appointment_timezone")}-help`} onChange={(value) => queue.edit("appointment_timezone", value)} />
                    <p id={`${id("appointment_timezone")}-help`} className="mt-1 text-xs text-neutral-400">{fieldError("appointment_timezone") || (localTime ? `Your time: ${localTime}` : "The date and time above use this timezone.")}</p>
                </div>
                <div className="min-w-0">
                    <label htmlFor={id("meeting_medium")} className="mb-1.5 block text-xs text-neutral-400">Meeting type</label>
                    {configuration.mediums.length === 1 ? <p id={id("meeting_medium")} className="flex min-h-11 items-center text-sm text-neutral-200">{APPOINTMENT_MEDIUM_OPTIONS.find((option) => option.key === configuration.mediums[0])?.label}</p> : <select id={id("meeting_medium")} className={appointmentInputClass} value={row.meeting_medium} onChange={(event) => { queue.edit("meeting_medium", event.target.value); if (event.target.value === "phone") queue.edit("meeting_link", "") }}>
                        {configuration.mediums.map((medium) => <option key={medium} value={medium}>{APPOINTMENT_MEDIUM_OPTIONS.find((option) => option.key === medium)?.label}</option>)}
                    </select>}
                </div>
                {row.meeting_medium !== "phone" ? field("meeting_link", "Meeting link", "url", true) : null}
            </div>
        </fieldset>
        {configuration.fields.some((item) => item.key !== "phone" && item.key !== "email") ? <fieldset disabled={disabled}>
            <legend className="mb-3 text-sm font-medium text-neutral-200">Client-requested information</legend>
            <div className="grid gap-3 sm:grid-cols-2">{configuration.fields.filter((item) => item.key !== "phone" && item.key !== "email").map((item) => field(`detail:${item.key}`, APPOINTMENT_FIELD_OPTIONS.find((option) => option.key === item.key)!.label, "text", item.required, item.key === "notes"))}</div>
        </fieldset> : null}
        {issues.length ? <div className="text-xs text-neutral-400">
            <p className="mb-1">{issues.length} {issues.length === 1 ? "detail needs" : "details need"} attention before submission:</p>
            <div className="flex flex-wrap gap-x-3 gap-y-1">{issues.map((issue) => <button key={issue.field} type="button" onClick={() => { setAttempted(true); focus(issue.field) }} className="min-h-8 text-left underline decoration-neutral-600 underline-offset-4">{fieldLabel(issue.field)}</button>)}</div>
        </div> : <p className="text-xs text-neutral-400">All required details are complete.</p>}
        {snapshot.error ? <div role="alert" className="space-y-2 text-sm text-red-300">
            <p>{snapshot.error}</p>
            {snapshot.conflict ? <>
                <button type="button" className="min-h-9 underline underline-offset-4" onClick={async () => {
                    setReviewError(null)
                    try { const latest = await onReview(); if (latest) setReviewed(latest); else setReviewError("This appointment is no longer available. Copy your unsaved text before leaving.") }
                    catch { setReviewError("Could not load the latest appointment. Your changes are preserved.") }
                }}>Review latest saved values</button>
                {reviewError ? <p>{reviewError}</p> : null}
                {reviewed ? <div className="space-y-2 text-neutral-300">
                    <p>Latest saved values for the fields you changed:</p>
                    {Object.keys(snapshot.changes).map((key) => <p key={key} className="whitespace-pre-wrap break-words text-xs">{fieldLabel(key as AppointmentUpdateField)}: {appointmentFieldValue(reviewed, key as AppointmentUpdateField) || "Empty"}</p>)}
                    <div className="flex flex-wrap gap-3">
                        {reviewed.workflow_status === "draft" ? <button type="button" className="min-h-9 underline underline-offset-4" onClick={() => { void queue.keepChangesAfterReview(reviewed); setReviewed(null) }}>Save my changes</button> : null}
                        <button type="button" className="min-h-9 underline underline-offset-4" onClick={() => { queue.discardChanges(reviewed); setReviewed(null) }}>Use saved version</button>
                    </div>
                </div> : null}
            </> : <button type="button" className="min-h-9 underline underline-offset-4" onClick={() => void queue.retry()}>Retry saving</button>}
        </div> : null}
        <div className="border-t border-neutral-800 pt-4">
            <p className="text-sm text-neutral-200">{appointmentScheduleLabel(row)} · {APPOINTMENT_MEDIUM_OPTIONS.find((option) => option.key === row.meeting_medium)?.label}</p>
            <p className="mt-1 text-xs text-neutral-400">Submitting notifies the client and locks this appointment for editing.</p>
            {messagingError ? <p className="mt-2 text-sm text-amber-300">{messagingError} <Link href={communicationsHref} className="underline underline-offset-4">Open Communications</Link></p> : null}
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                <p role="status" className="text-xs text-neutral-400">{snapshot.error ? "Changes not saved" : snapshot.saving || dirty ? "Saving…" : "Saved"}</p>
                <button type="submit" disabled={disabled || Boolean(messagingError) || snapshot.conflict} className="min-h-11 rounded-md bg-white px-4 text-sm font-medium text-black hover:bg-neutral-200 disabled:opacity-50">{submitting ? "Submitting…" : "Submit appointment"}</button>
            </div>
        </div>
    </form>
}
