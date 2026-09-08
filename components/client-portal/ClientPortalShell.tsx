"use client"

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import { ClientPortalChat } from "@/components/client-portal/ClientPortalChat"
import { ClientPortalAppointments } from "@/components/client-portal/ClientPortalAppointments"
import { ClientPortalResources } from "@/components/client-portal/ClientPortalResources"
import { ClientBrandLogo } from "@/components/client-branding/ClientBrandLogo"
import { DetailField, DetailFields } from "@/components/detail"
import { appointmentDateLabels, type PortalAppointment } from "@/lib/client-portal/appointments"

function localGreeting(hour: number) {
    if (hour < 12) return "Good morning"
    if (hour < 18) return "Good afternoon"
    return "Good evening"
}

function ChatIcon() {
    return <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5 fill-none stroke-current" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M20 15a3 3 0 0 1-3 3H9l-5 3v-6a3 3 0 0 1-1-2.2V7a3 3 0 0 1 3-3h11a3 3 0 0 1 3 3Z" /><path d="M8 9h8M8 13h5" /></svg>
}

function PortalSidePanel({ title, workspaceName, onBack, children, chat = false }: { title: string; workspaceName: string; onBack: () => void; children: ReactNode; chat?: boolean }) {
    const panelRef = useRef<HTMLElement>(null)
    const backRef = useRef<HTMLButtonElement>(null)
    useEffect(() => {
        const origin = document.activeElement instanceof HTMLElement ? document.activeElement : null
        const previousOverflow = document.body.style.overflow
        document.body.style.overflow = "hidden"
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
            document.body.style.overflow = previousOverflow
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
        {appointment.meetingLink ? <a href={appointment.meetingLink} target="_blank" rel="noopener noreferrer" className="mt-6 inline-flex min-h-11 items-center justify-center rounded-lg bg-[var(--onboarding-primary,#1E3A5F)] px-4 text-sm font-semibold text-white">Open {labels.medium} meeting</a> : null}
        <p className="mt-6 text-sm leading-6 text-[var(--onboarding-muted,#475569)]">Need to change something? Send your team a message in Chat.</p>
    </>
}

export function ClientPortalShell({ token, workspaceName, logoSrc, primaryPersonName, privacyPolicyUrl, termsOfServiceUrl }: { token: string; workspaceName: string; logoSrc?: string | null; primaryPersonName: string; privacyPolicyUrl?: string | null; termsOfServiceUrl?: string | null }) {
    const [panel, setPanel] = useState<"chat" | PortalAppointment | null>(null)
    const [greeting, setGreeting] = useState("Welcome")
    const closePanel = useCallback(() => setPanel(null), [])
    useEffect(() => {
        const update = () => setGreeting(localGreeting(new Date().getHours()))
        update()
        const interval = window.setInterval(update, 60_000)
        return () => window.clearInterval(interval)
    }, [])

    return <div data-betelgeze-client-portal-session="valid" className="min-h-screen bg-[var(--onboarding-page,#F8F7F3)] text-[var(--onboarding-text,#0F172A)]">
        <div data-portal-content>
            <header className="border-b border-black/10 bg-[var(--onboarding-surface,#FFFFFF)]">
                <div className="mx-auto flex h-20 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
                    <ClientBrandLogo logoSrc={logoSrc} workspaceName={workspaceName} className="h-9 max-w-[min(12rem,45vw)]" fallbackClassName="min-w-0 truncate text-lg font-semibold tracking-tight" />
                    <nav aria-label="Client portal" className="flex shrink-0 items-center gap-2 sm:gap-4"><a href="#resources" className="inline-flex min-h-11 items-center px-2 text-sm font-medium text-[var(--onboarding-muted,#475569)] hover:text-[var(--onboarding-text,#0F172A)]">Resources</a><button type="button" onClick={() => setPanel("chat")} className="inline-flex h-11 items-center gap-2 rounded-lg bg-[var(--onboarding-primary,#1E3A5F)] px-4 text-sm font-semibold text-white hover:brightness-95"><ChatIcon /><span>Chat</span></button></nav>
                </div>
            </header>
            <main data-client-portal-main className="mx-auto max-w-6xl px-4 py-7 sm:px-6 sm:py-10 lg:px-8">
                <section aria-labelledby="portal-greeting" className="mb-7 sm:mb-8"><p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--onboarding-muted,#475569)]">{workspaceName} · Client portal</p><h1 id="portal-greeting" className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">{greeting}, {primaryPersonName.trim().split(/\s+/)[0] || "there"}</h1><p className="mt-3 text-sm leading-6 text-[var(--onboarding-muted,#475569)] sm:text-base">Your appointments, shared files, and team. All in one place.</p></section>
                <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]"><ClientPortalAppointments token={token} onOpen={setPanel} /><ClientPortalResources token={token} /></div>
                <div className="mt-6 flex flex-wrap items-center justify-between gap-3 px-1"><p className="text-sm text-[var(--onboarding-muted,#475569)]">Have a question or an update for us?</p><button type="button" onClick={() => setPanel("chat")} className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-[var(--onboarding-primary,#1E3A5F)]"><ChatIcon />Message your team <span aria-hidden="true">↗</span></button></div>
            </main>
            <footer className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 pb-8 text-xs text-[var(--onboarding-muted,#475569)] sm:px-6 lg:px-8"><span>{workspaceName}</span><div className="flex gap-4">{privacyPolicyUrl ? <a href={privacyPolicyUrl} className="underline underline-offset-2">Privacy</a> : null}{termsOfServiceUrl ? <a href={termsOfServiceUrl} className="underline underline-offset-2">Terms</a> : null}</div></footer>
        </div>
        {panel ? <PortalSidePanel title={panel === "chat" ? "Chat" : "Appointment"} workspaceName={workspaceName} onBack={closePanel} chat={panel === "chat"}>{panel === "chat" ? <ClientPortalChat token={token} workspaceName={workspaceName} /> : <AppointmentDetail appointment={panel} />}</PortalSidePanel> : null}
    </div>
}
