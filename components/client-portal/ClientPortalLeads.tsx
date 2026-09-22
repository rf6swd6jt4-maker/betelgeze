"use client"

import { useCallback, useState } from "react"
import dynamic from "next/dynamic"
import { ClientPortalAppointments } from "@/components/client-portal/ClientPortalAppointments"
import { PortalIcon, PortalSection } from "@/components/client-portal/ClientPortalUI"
import type { PortalAppointment } from "@/lib/client-portal/appointments"
import type { PortalLeadMode } from "@/lib/client-portal/overview"
import styles from "./ClientPortalLayout.module.css"

const ClientPortalCalendar = dynamic(() => import("./ClientPortalCalendar").then((module) => module.ClientPortalCalendar))
const ClientPortalGhl = dynamic(() => import("./ClientPortalGhl").then((module) => module.ClientPortalGhl), {
    loading: () => <PortalSection id="ghl-connection" title="GHL" description="Contacts & opportunities" icon="connection"><p className="mt-4 text-sm">Loading connection…</p></PortalSection>,
})

export function ClientPortalLeads({ token, active, mode, onOpen }: { token: string; active: boolean; mode: PortalLeadMode; onOpen: (appointment: PortalAppointment) => void }) {
    const [ghlConnected, setGhlConnected] = useState(false)
    const [calendarVersion, setCalendarVersion] = useState(0)
    const onGhlConnection = useCallback((connected: boolean, reset = false) => { setGhlConnected(connected); if (reset) setCalendarVersion((value) => value + 1) }, [])
    if (mode === "appointments") return <ClientPortalAppointments token={token} onOpen={onOpen} />
    if (mode === "empty") return <PortalSection id="leads-empty" title="Leads" description="New enquiries and appointments from your services." icon="leads">
        <div className="flex min-h-0 flex-1 items-center justify-center px-4 py-10 text-center"><div><PortalIcon name="leads" className="mx-auto h-8 w-8 text-[var(--onboarding-muted,#475569)]" /><h3 className="mt-4 text-base font-semibold">Nothing here yet</h3><p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-[var(--onboarding-muted,#475569)]">New leads and appointments will appear here when activity begins.</p></div></div>
    </PortalSection>
    return <div className={`${styles.results} ${ghlConnected ? styles.calendarResults : ""}`}>
        <div className="min-h-0 min-w-0">{ghlConnected ? <ClientPortalCalendar key={`${token}:${calendarVersion}`} token={token} active={active} /> : <PortalSection id="leads-overview" title="Leads" description="Contacts, opportunities and appointments." icon="leads"><div className="flex min-h-0 flex-1 items-center justify-center text-center"><p className="max-w-sm text-sm leading-6 text-[var(--onboarding-muted,#475569)]">Connect GHL to show your lead activity here.</p></div></PortalSection>}</div>
        <div className="grid min-w-0 auto-rows-max content-start gap-4 lg:gap-6"><ClientPortalGhl key={token} token={token} onConnection={onGhlConnection} active={active} /></div>
    </div>
}
