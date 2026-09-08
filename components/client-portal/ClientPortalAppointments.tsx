"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { List, ListItem, ListPrimaryRow, ListSecondaryRow, ListTitle, ListTrailing } from "@/components/list/List"
import { ListPrimaryAction } from "@/components/list/ListPrimaryAction"
import { FilterRail, FilterRailButton } from "@/components/panel/FilterRail"
import { PortalIcon, PortalSection } from "@/components/client-portal/ClientPortalUI"
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

    return <PortalSection id="appointments" title="Your appointments" description="See what’s coming up and view past bookings." icon="calendar">
        {/* This period filters the independently loaded booking panel without navigating the portal. */}
        <FilterRail surface="light" ariaLabel="Appointment period">
            {[{ value: "upcoming", label: "Upcoming" }, { value: "past", label: "Past appointments" }].map((period) => <FilterRailButton key={period.value} selected={view === period.value} onClick={() => { if (view === period.value) return; setView(period.value); setAppointments([]); setHasMore(false); setLoading(true); setError(null) }}>{period.label}</FilterRailButton>)}
        </FilterRail>
        {error ? <p role="alert" className="mt-5 text-sm text-red-700">{error} <button type="button" onClick={() => { setLoading(true); void load() }} className="underline">Try again</button></p> : null}
        {loading && !appointments.length ? <p role="status" className="py-10 text-center text-sm text-[var(--onboarding-muted,#475569)]">Loading appointments…</p> : null}
        {!loading && !error && !appointments.length ? <div className="px-3 py-9 text-center sm:py-12"><span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-black/[0.025] text-[var(--onboarding-muted,#475569)]"><PortalIcon name="calendar" className="h-7 w-7" /></span><h3 className="mt-4 text-base font-semibold">{view === "past" ? "No past appointments" : "No upcoming appointments"}</h3><p className="mx-auto mt-2 max-w-[17rem] text-sm leading-6 text-[var(--onboarding-muted,#475569)]">{view === "past" ? "Your previous bookings will be kept here." : "When your team adds a booking, you’ll find the date and details here."}</p></div> : null}
        {appointments.length ? <List surface="light" embedded ariaLabel={view === "past" ? "Past appointments" : "Upcoming appointments"}>{appointments.map((appointment) => {
            const labels = appointmentDateLabels(appointment)
            const date = new Date(appointment.appointmentAt)
            const compactDate = new Intl.DateTimeFormat("en-GB", { timeZone: appointment.timezone, day: "numeric", month: "short" }).format(date)
            const compactTime = new Intl.DateTimeFormat("en-US", { timeZone: appointment.timezone, hour: "numeric", minute: "2-digit" }).format(date)
            return <ListItem key={appointment.id}>
                <ListPrimaryRow><ListTitle className="flex-1"><button type="button" title={appointment.contactName} onClick={() => onOpen(appointment)} className="block w-full truncate text-left hover:underline focus-visible:outline-2 focus-visible:outline-offset-[-2px]">{appointment.contactName}</button></ListTitle><Status surface="light" tone={view === "past" ? "grey" : "green"} label={view === "past" ? "Past" : "Booked"} /></ListPrimaryRow>
                <ListSecondaryRow className="text-[var(--onboarding-muted,#475569)]"><time title={`${labels.date} · ${labels.time}`} aria-label={`${labels.date} · ${labels.time}`} dateTime={appointment.appointmentAt} className="min-w-0 truncate text-xs sm:text-sm"><span className="sm:hidden">{compactDate} · {compactTime}</span><span className="hidden sm:inline">{labels.date} · {labels.time}</span></time><ListTrailing><ListPrimaryAction label="Details" accessibleLabel={`View appointment for ${appointment.contactName}`} onClick={() => onOpen(appointment)} /></ListTrailing></ListSecondaryRow>
            </ListItem>
        })}</List> : null}
        {appointments.length ? <p className="mt-3 text-xs leading-5 text-[var(--onboarding-muted,#475569)]">Times are local to each booking. Open Details for the timezone.</p> : null}
        {hasMore ? <button disabled={loading} type="button" onClick={() => { setLoading(true); void load(appointments.length) }} className="mt-4 min-h-11 text-sm font-semibold">{loading ? "Loading…" : "Load more appointments"}</button> : null}
    </PortalSection>
}
