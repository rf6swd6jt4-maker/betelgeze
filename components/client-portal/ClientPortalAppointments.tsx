"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { List, ListItem, ListPrimaryRow, ListSecondaryRow, ListTitle, ListTrailing } from "@/components/list/List"
import { ListActionMenu } from "@/components/list/ListActionMenu"
import { MobileListActionSurface } from "@/components/list/MobileCardActionSurface"
import { Status } from "@/components/ui"
import { appointmentDateLabels, type PortalAppointment } from "@/lib/client-portal/appointments"

export function ClientPortalAppointments({ token, onOpen }: { token: string; onOpen: (appointment: PortalAppointment) => void }) {
    const [view, setView] = useState("upcoming")
    const [appointments, setAppointments] = useState<PortalAppointment[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [hasMore, setHasMore] = useState(false)
    const revision = useRef(0)
    const load = useCallback(async (offset = 0, signal?: AbortSignal) => {
        const current = ++revision.current
        try {
            const response = await fetch(`/api/client-portal/session/${encodeURIComponent(token)}/appointments?view=${view}&offset=${offset}`, { cache: "no-store", signal })
            const result = await response.json()
            if (!response.ok) throw new Error(result.error || "Could not load appointments.")
            if (current !== revision.current || signal?.aborted) return
            setAppointments((previous) => offset ? [...previous, ...result.appointments.filter((item: PortalAppointment) => !previous.some((old) => old.id === item.id))] : result.appointments)
            setHasMore(result.hasMore)
            setError(null)
        } catch (failure) { if (current === revision.current && !signal?.aborted) setError(failure instanceof Error ? failure.message : "Could not load appointments.") }
        finally { if (current === revision.current && !signal?.aborted) setLoading(false) }
    }, [token, view])
    useEffect(() => {
        const controller = new AbortController()
        queueMicrotask(() => { if (!controller.signal.aborted) void load(0, controller.signal) })
        const refresh = () => { if (document.visibilityState === "visible") void load(0, controller.signal) }
        const interval = window.setInterval(refresh, 60_000)
        window.addEventListener("focus", refresh)
        return () => { controller.abort(); window.clearInterval(interval); window.removeEventListener("focus", refresh) }
    }, [load])

    return <section aria-labelledby="appointments-title" className="rounded-2xl border border-black/10 bg-[var(--onboarding-surface,#FFFFFF)] p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4"><div><h2 id="appointments-title" className="text-xl font-semibold tracking-tight">Your appointments</h2><p className="mt-1 text-sm leading-6 text-[var(--onboarding-muted,#475569)]">Bookings shared by your team.</p></div>
            <label className="text-sm"><span className="sr-only">Appointment period</span><select value={view} onChange={(event) => { setView(event.target.value); setAppointments([]); setHasMore(false); setLoading(true) }} className="min-h-11 rounded-lg border border-black/10 bg-transparent px-3 font-medium"><option value="upcoming">Upcoming</option><option value="past">Past appointments</option></select></label>
        </div>
        <p className="mt-3 text-xs text-[var(--onboarding-muted,#475569)]">Times shown in the booking timezone.</p>
        {error ? <p role="alert" className="mt-5 text-sm text-red-700">{error} <button type="button" onClick={() => { setLoading(true); void load() }} className="underline">Try again</button></p> : null}
        {loading && !appointments.length ? <p role="status" className="py-10 text-center text-sm text-[var(--onboarding-muted,#475569)]">Loading appointments…</p> : null}
        {!loading && !error && !appointments.length ? <div className="py-8 text-center"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="mx-auto h-9 w-9 text-[var(--onboarding-muted,#475569)]" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M16 3v4M8 3v4M3 11h18m-13 5 3 3 5-5" /></svg><h3 className="mt-4 font-semibold">{view === "past" ? "No past appointments" : "You’re up to date"}</h3><p className="mx-auto mt-2 max-w-xs text-sm leading-6 text-[var(--onboarding-muted,#475569)]">{view === "past" ? "Earlier bookings will stay here for reference." : "New bookings will appear here as your team shares them."}</p></div> : null}
        {appointments.length ? <List surface="light" ariaLabel={view === "past" ? "Past appointments" : "Upcoming appointments"}>{appointments.map((appointment) => {
            const labels = appointmentDateLabels(appointment)
            const actions = [{ label: "View appointment", action: () => onOpen(appointment) }]
            return <ListItem key={appointment.id}><MobileListActionSurface actions={actions} label={`Open ${appointment.contactName} appointment`}>
                <ListPrimaryRow><ListTitle className="flex-1"><button type="button" onClick={() => onOpen(appointment)} className="block w-full truncate text-left hover:underline">{appointment.contactName}</button></ListTitle><Status surface="light" tone={view === "past" ? "grey" : "green"} label={view === "past" ? "Past" : "Booked"} /></ListPrimaryRow>
                <ListSecondaryRow className="text-[var(--onboarding-muted,#475569)]"><time dateTime={appointment.appointmentAt} className="min-w-0 truncate text-xs sm:text-sm">{labels.date} · {labels.time}</time><ListTrailing><span className="hidden text-xs xl:inline">{labels.medium}</span><ListActionMenu actions={actions} className="hidden sm:inline-flex" /></ListTrailing></ListSecondaryRow>
            </MobileListActionSurface></ListItem>
        })}</List> : null}
        {hasMore ? <button disabled={loading} type="button" onClick={() => { setLoading(true); void load(appointments.length) }} className="mt-4 min-h-11 text-sm font-semibold">{loading ? "Loading…" : "Load more appointments"}</button> : null}
    </section>
}
