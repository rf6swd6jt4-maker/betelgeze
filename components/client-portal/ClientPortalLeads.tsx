"use client"

import { useCallback, useState } from "react"
import dynamic from "next/dynamic"
import { ClientPortalAppointments } from "@/components/client-portal/ClientPortalAppointments"
import { PortalIcon, PortalSection } from "@/components/client-portal/ClientPortalUI"
import type { PortalAppointment } from "@/lib/client-portal/appointments"
import type { PortalLeadMode } from "@/lib/client-portal/overview"
import type { GhlAppointmentEntry } from "@/lib/client-portal/appointment-summary"
import styles from "./ClientPortalLayout.module.css"

const ClientPortalCalendar = dynamic(() => import("./ClientPortalCalendar").then((module) => module.ClientPortalCalendar))
const ClientPortalGhl = dynamic(() => import("./ClientPortalGhl").then((module) => module.ClientPortalGhl), {
    loading: () => <PortalSection id="appointments-setup" title="Appointments" description="Calendar setup" icon="connection"><p className="mt-4 text-sm">Checking setup…</p></PortalSection>,
})

export function ClientPortalLeads({ token, active, mode, onOpen, initialAppointment, displayName, detailsOpen = false, deferProviderStatus = false, onDetailsOpenChange, onBackToCalendar }: { token: string; active: boolean; mode: PortalLeadMode; onOpen: (appointment: PortalAppointment) => void; initialAppointment?: GhlAppointmentEntry; displayName?: string; detailsOpen?: boolean; deferProviderStatus?: boolean; onDetailsOpenChange?: (open: boolean) => void; onBackToCalendar?: () => void }) {
    const [ghlConnected, setGhlConnected] = useState(Boolean(initialAppointment))
    const [calendarVersion, setCalendarVersion] = useState(0)
    const onGhlConnection = useCallback((connected: boolean, reset = false) => { setGhlConnected(connected); if (!connected) onDetailsOpenChange?.(false); if (!connected || reset) setCalendarVersion((value) => value + 1) }, [onDetailsOpenChange])
    const showingInitialDetail = Boolean(initialAppointment) && detailsOpen
    if (mode === "appointments" && !showingInitialDetail) return <ClientPortalAppointments token={token} onOpen={onOpen} />
    if (mode === "empty" && !showingInitialDetail) return <PortalSection id="leads-empty" title="Leads" description="New enquiries and appointments from your services." icon="leads">
        <div className="flex min-h-0 flex-1 items-center justify-center px-4 py-10 text-center"><div><PortalIcon name="leads" className="mx-auto h-8 w-8 text-[var(--onboarding-muted,#475569)]" /><h3 className="mt-4 text-base font-semibold">Nothing here yet</h3><p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-[var(--onboarding-muted,#475569)]">New leads and appointments will appear here when activity begins.</p></div></div>
    </PortalSection>
    return <div className={detailsOpen ? "min-w-0" : `${styles.results} ${ghlConnected ? styles.calendarResults : ""}`}>
        {ghlConnected ? <div className="min-h-0 min-w-0"><ClientPortalCalendar key={`${token}:${calendarVersion}`} token={token} active={active} initialAppointment={calendarVersion === 0 ? initialAppointment : undefined} displayName={displayName} onDetailsOpenChange={onDetailsOpenChange} onBackToCalendar={onBackToCalendar} /></div> : null}
        <div hidden={detailsOpen} className={detailsOpen ? "hidden" : "grid min-w-0 auto-rows-max content-start gap-4 lg:gap-6"}>{!deferProviderStatus ? <ClientPortalGhl key={token} token={token} onConnection={onGhlConnection} active={active && !detailsOpen} /> : null}</div>
    </div>
}
