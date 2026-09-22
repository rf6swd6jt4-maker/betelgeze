"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { QuickStats } from "@/components/panel/QuickStats"
import { Status } from "@/components/ui/Status"
import { PortalSection } from "./ClientPortalUI"
import type { GhlSummary } from "@/lib/client-portal/ghl-types"

const number = (value: number) => value.toLocaleString("en-US")

export function ClientPortalGhl({ token, active, onConnection }: { token: string; active: boolean; onConnection?: (connected: boolean) => void }) {
    const [saved, setSaved] = useState<GhlSummary | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [reading, setReading] = useState(true)
    const controller = useRef<AbortController | null>(null)
    const lastRead = useRef(0)
    const api = `/api/client-portal/session/${token}/connections/ghl`

    const load = useCallback(async () => {
        if (controller.current) return
        const request = new AbortController(); controller.current = request; setReading(true)
        const timeout = window.setTimeout(() => request.abort(), 25_000)
        try {
            const response = await fetch(api, { cache: "no-store", signal: request.signal })
            const value = await response.json()
            if (!response.ok) throw new Error(value.error || "Your appointment setup status could not be loaded.")
            setSaved(value); setError(null); lastRead.current = Date.now(); onConnection?.(value.connected === true)
        } catch (problem) {
            if (request.signal.aborted) setError("Your appointment setup status took too long to load. Please try again.")
            else setError(problem instanceof Error ? problem.message : "Your appointment setup status could not be loaded.")
        } finally { window.clearTimeout(timeout); if (controller.current === request) controller.current = null; setReading(false) }
    }, [api, onConnection])

    useEffect(() => {
        const timer = window.setTimeout(() => void load(), 0)
        return () => { window.clearTimeout(timer); controller.current?.abort() }
    }, [load])
    useEffect(() => {
        const refresh = () => { if (active && document.visibilityState === "visible" && Date.now() - lastRead.current > 60_000) void load() }
        window.addEventListener("focus", refresh); document.addEventListener("visibilitychange", refresh)
        return () => { window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh) }
    }, [active, load])

    if (!saved?.connected) return <PortalSection id="appointments-setup" title="Appointments" description="Calendar setup" icon="connection">
        <div className="flex min-h-48 flex-1 items-center justify-center px-4 text-center"><div><Status surface="light" tone={error ? "red" : "yellow"} label={error ? "Setup status unavailable" : reading ? "Checking setup…" : "Getting ready"} /><h3 className="mt-4 text-base font-semibold">We’re getting your appointments calendar ready.</h3><p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[var(--onboarding-muted,#475569)]">Our team is connecting your appointment system. Your calendar and results will appear here when setup is complete.</p>{error ? <button type="button" onClick={() => void load()} className="mt-4 min-h-11 px-3 text-sm font-semibold text-[var(--onboarding-primary,#1E3A5F)]">Try again</button> : null}</div></div>
    </PortalSection>

    const metrics = saved.metrics
    return <PortalSection id="ghl-results" title="Results" description="Contacts & opportunities" icon="connection">
        <div className="mt-4 min-w-0"><Status surface="light" tone={saved.error ? "red" : "green"} wrap label={saved.error ? "Results need attention" : "Ready"} />
            {saved.locationName ? <p className="mt-2 break-words text-sm font-medium">{saved.locationName}</p> : null}
            {metrics ? <><QuickStats surface="light" ariaLabel="Opportunity metrics" items={[{ label: "Open", value: number(metrics.open) }, { label: "Won", value: number(metrics.won) }, { label: "Lost", value: number(metrics.lost) }]} /><p className="mt-4 text-sm"><strong className="font-semibold tabular-nums">{number(metrics.contacts)}</strong> contacts <span aria-hidden="true" className="px-1 text-black/25">·</span> <strong className="font-semibold tabular-nums">{number(metrics.opportunities)}</strong> opportunities</p></> : null}
            {saved.refreshedAt ? <p className="mt-2 text-xs leading-5 text-[var(--onboarding-muted,#475569)]">Updated {new Date(saved.refreshedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}.</p> : null}
            {saved.error ? <p role="alert" className="mt-3 text-sm text-red-800">{saved.error}</p> : null}
        </div>
    </PortalSection>
}
