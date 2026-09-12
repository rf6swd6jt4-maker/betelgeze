"use client"

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import dynamic from "next/dynamic"
import { ClientPortalChat } from "@/components/client-portal/ClientPortalChat"
import { ClientPortalAppointments } from "@/components/client-portal/ClientPortalAppointments"
import { ClientPortalResources } from "@/components/client-portal/ClientPortalResources"
import { PortalIcon, PortalSection, portalPrimaryButton } from "@/components/client-portal/ClientPortalUI"
import { ClientBrandLogo } from "@/components/client-branding/ClientBrandLogo"
import { DetailField, DetailFields } from "@/components/detail"
import { appointmentDateLabels, type PortalAppointment } from "@/lib/client-portal/appointments"
import { FilterRailButton } from "@/components/panel/FilterRail"
import styles from "./ClientPortalLayout.module.css"

const ClientPortalGhl = dynamic(() => import("./ClientPortalGhl").then((module) => module.ClientPortalGhl), {
    loading: () => <PortalSection id="ghl-connection" title="GHL" description="Contacts & opportunities" icon="connection"><p className="mt-4 text-sm">Loading connection…</p></PortalSection>,
})

function localGreeting(hour: number) {
    if (hour < 12) return "Good morning"
    if (hour < 18) return "Good afternoon"
    return "Good evening"
}

function PortalSidePanel({ title, workspaceName, onBack, children, chat = false }: { title: string; workspaceName: string; onBack: () => void; children: ReactNode; chat?: boolean }) {
    const panelRef = useRef<HTMLElement>(null)
    const backRef = useRef<HTMLButtonElement>(null)
    useEffect(() => {
        const origin = document.activeElement instanceof HTMLElement ? document.activeElement : null
        const main = document.querySelector<HTMLElement>("[data-portal-content]")
        const wasInert = main?.inert ?? false
        if (main) main.inert = true
        const keyboard = (event: KeyboardEvent) => {
            if (event.key === "Escape") { event.preventDefault(); onBack(); return }
            if (event.key !== "Tab" || !panelRef.current) return
            const focusable = [...panelRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [href], [contenteditable="true"], [tabindex]:not([tabindex="-1"])')].filter((item) => item.getClientRects().length > 0)
            const first = focusable[0]
            const last = focusable.at(-1)
            if (!first || !last) return
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
        }
        backRef.current?.focus({ preventScroll: true })
        document.addEventListener("keydown", keyboard)
        return () => {
            if (main) main.inert = wasInert
            document.removeEventListener("keydown", keyboard)
            origin?.focus({ preventScroll: true })
        }
    }, [onBack])

    return <>
        <button type="button" aria-label="Close panel" tabIndex={-1} onClick={onBack} className="fixed inset-0 z-40 hidden bg-black/25 backdrop-blur-[1px] md:block" />
        <aside ref={panelRef} data-client-portal-panel role="dialog" aria-modal="true" aria-labelledby="client-portal-panel-title" className="betelgeze-popup-fade fixed inset-x-0 top-0 z-50 flex h-[var(--client-portal-viewport-bottom,100dvh)] min-h-0 flex-col bg-[var(--onboarding-surface,#FFFFFF)] text-[var(--onboarding-text,#0F172A)] shadow-2xl [backface-visibility:hidden] md:left-auto md:w-[30rem] md:border-l md:border-black/10">
            <header className="flex h-16 shrink-0 items-center gap-3 border-b border-black/10 px-4 sm:px-5">
                <button ref={backRef} type="button" onClick={onBack} className="inline-flex h-11 items-center gap-1 rounded-lg px-2 text-sm font-semibold text-[var(--onboarding-primary,#1E3A5F)] hover:bg-black/5" aria-label={`Back from ${title}`}><svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5 fill-none stroke-current" strokeWidth="1.8"><path d="m15 18-6-6 6-6" /></svg><span>Back</span></button>
                <div className="min-w-0 border-l border-black/10 pl-4"><h2 id="client-portal-panel-title" className="truncate text-base font-semibold">{title}</h2><p className="truncate text-xs text-[var(--onboarding-muted,#475569)]">{workspaceName}</p></div>
            </header>
            <div className={`flex min-h-0 flex-1 flex-col ${chat ? "" : "overflow-y-auto p-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:p-6"}`}>{children}</div>
        </aside>
    </>
}

function AppointmentDetail({ appointment }: { appointment: PortalAppointment }) {
    const labels = appointmentDateLabels(appointment)
    const phone = appointment.phone?.replace(/[^+0-9]/g, "")
    return <>
        <p className="text-xs font-semibold uppercase tracking-wider text-[var(--onboarding-muted,#475569)]">Appointment details</p>
        <h3 className="mt-2 break-words text-2xl font-semibold tracking-tight">{appointment.contactName}</h3>
        <p className="mt-2 text-sm text-[var(--onboarding-muted,#475569)]">{labels.date} · {labels.time}</p>
        <DetailFields surface="light" columns={1}>
            <DetailField label="Meeting" icon="contact">{labels.medium}</DetailField>
            <DetailField label="Timezone" icon="time">{appointment.timezone.replaceAll("_", " ")}</DetailField>
            {appointment.phone ? <DetailField label="Phone" icon="contact"><a className="break-all underline underline-offset-4" href={`tel:${phone}`}>{appointment.phone}</a></DetailField> : null}
            {appointment.details.email ? <DetailField label="Email" icon="contact"><a className="break-all underline underline-offset-4" href={`mailto:${encodeURIComponent(appointment.details.email)}`}>{appointment.details.email}</a></DetailField> : null}
            {appointment.details.service ? <DetailField label="Service" icon="services"><span className="whitespace-pre-wrap break-words">{appointment.details.service}</span></DetailField> : null}
            {appointment.details.address ? <DetailField label="Address" icon="relationship"><span className="whitespace-pre-wrap break-words">{appointment.details.address}</span></DetailField> : null}
            {appointment.details.notes ? <DetailField label="Notes" icon="description"><span className="whitespace-pre-wrap break-words">{appointment.details.notes}</span></DetailField> : null}
        </DetailFields>
        {appointment.meetingLink ? <a href={appointment.meetingLink} target="_blank" rel="noopener noreferrer" className={`mt-6 ${portalPrimaryButton}`}>Open {labels.medium} meeting</a> : null}
        <p className="mt-6 text-sm leading-6 text-[var(--onboarding-muted,#475569)]">Need to change something? Send your team a message in Chat.</p>
    </>
}

export function ClientPortalShell({ token, workspaceName, logoSrc, primaryPersonName, privacyPolicyUrl, termsOfServiceUrl }: { token: string; workspaceName: string; logoSrc?: string | null; primaryPersonName: string; privacyPolicyUrl?: string | null; termsOfServiceUrl?: string | null }) {
    const [panel, setPanel] = useState<"chat" | PortalAppointment | null>(null)
    const [greeting, setGreeting] = useState("Welcome")
    const [activePage, setActivePage] = useState("appointments")
    const closePanel = useCallback(() => setPanel(null), [])
    useEffect(() => {
        const elements = [document.documentElement, document.body]
        const previous = elements.map((element) => element.style.overflow)
        elements.forEach((element) => { element.style.overflow = "hidden" })
        return () => elements.forEach((element, index) => { element.style.overflow = previous[index] })
    }, [])
    useEffect(() => {
        const update = () => setGreeting(localGreeting(new Date().getHours()))
        update()
        const interval = window.setInterval(update, 60_000)
        return () => window.clearInterval(interval)
    }, [])

    return <div data-betelgeze-client-portal-session="valid" className={`${styles.viewport} bg-[var(--onboarding-page,#F8F7F3)] text-[var(--onboarding-text,#0F172A)]`}>
        <div data-portal-content className="flex h-full min-h-0 flex-col">
            <header className="shrink-0 border-b border-black/[0.07] bg-[var(--onboarding-surface,#FFFFFF)]">
                <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6 lg:h-20 lg:px-8">
                    <ClientBrandLogo logoSrc={logoSrc} workspaceName={workspaceName} className="h-9 min-w-0 max-w-[min(12rem,38vw)] shrink" fallbackClassName="min-w-0 truncate text-lg font-semibold tracking-tight" />
                    <div className="flex shrink-0 items-center gap-1 sm:gap-3">
                        <nav aria-label="Portal pages" data-surface="light" className="group/rail flex items-center">
                            <FilterRailButton selected={activePage === "appointments"} aria-controls="appointments" onClick={() => setActivePage("appointments")}>Results</FilterRailButton>
                            <FilterRailButton selected={activePage === "resources"} aria-controls="resources" onClick={() => setActivePage("resources")}>Files</FilterRailButton>
                        </nav>
                        <button type="button" onClick={() => setPanel("chat")} className={portalPrimaryButton}><PortalIcon name="chat" /><span>Chat</span></button>
                    </div>
                </div>
            </header>
            <main data-client-portal-main className="mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col px-4 pt-4 sm:px-6 lg:px-8 lg:pt-6">
                <section data-portal-greeting aria-labelledby="portal-greeting" className="mb-3 shrink-0 lg:mb-6"><p className="hidden text-sm font-medium text-[var(--onboarding-muted,#475569)] lg:block">Your client portal</p><h1 id="portal-greeting" className="truncate text-2xl font-semibold leading-tight tracking-tight lg:mt-2 lg:text-[2rem]">{greeting}, {primaryPersonName.trim().split(/\s+/)[0] || "there"}</h1><p className="mt-2 hidden text-sm leading-6 text-[var(--onboarding-muted,#475569)] lg:block">Check your appointments or send files to your team.</p></section>
                <div className="grid min-h-0 flex-1 grid-cols-1 gap-4">
                    <div className={`min-h-0 min-w-0 ${activePage === "appointments" ? "block" : "hidden"}`}>
                        <div className={styles.results}>
                            <div className="min-h-0 min-w-0"><ClientPortalAppointments token={token} onOpen={setPanel} /></div>
                            <div aria-label="Connections" className="grid min-h-0 min-w-0 auto-rows-max content-start gap-4 lg:gap-6 lg:overflow-y-auto">
                                <ClientPortalGhl key={token} token={token} active={activePage === "appointments" && panel === null} />
                                <PortalSection id="google-ads-connection" title="Google Ads" description="Google Ads connection" icon="connection"><p className="mt-5 text-sm text-[var(--onboarding-muted,#475569)]">Connection setup coming soon.</p></PortalSection>
                            </div>
                        </div>
                    </div>
                    {/* Keep the uploader mounted when changing panels so active transfers continue. */}
                    <div className={`min-h-0 min-w-0 ${activePage === "resources" ? "block" : "hidden"}`}><ClientPortalResources token={token} /></div>
                </div>
            </main>
            <footer className="mx-auto flex w-full max-w-6xl shrink-0 items-center justify-between gap-4 px-4 pb-[env(safe-area-inset-bottom)] text-xs text-[var(--onboarding-muted,#475569)] sm:px-6 lg:px-8"><span className="min-w-0 truncate">{workspaceName}</span><div className="flex shrink-0 gap-5">{privacyPolicyUrl ? <a href={privacyPolicyUrl} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center underline underline-offset-4">Privacy</a> : null}{termsOfServiceUrl ? <a href={termsOfServiceUrl} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center underline underline-offset-4">Terms</a> : null}</div></footer>
        </div>
        {panel ? <PortalSidePanel title={panel === "chat" ? "Chat" : "Appointment"} workspaceName={workspaceName} onBack={closePanel} chat={panel === "chat"}>{panel === "chat" ? <ClientPortalChat token={token} workspaceName={workspaceName} /> : <AppointmentDetail appointment={panel} />}</PortalSidePanel> : null}
    </div>
}
