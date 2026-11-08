"use client"

import { useState, type FormEvent } from "react"
import { CenteredDialog } from "@/components/ui/CenteredDialog"
import { Button } from "@/components/ui"

const fieldClass = "h-10 w-full min-w-0 rounded-lg border border-neutral-700 bg-black px-3 text-sm outline-none placeholder:text-neutral-600 focus:border-neutral-500"
const MAX_VARIABLE_LENGTH = 300

function defaultReportPeriod() {
    const end = new Date()
    const day = end.getDay()
    const lastSunday = new Date(end)
    lastSunday.setDate(end.getDate() - (day === 0 ? 0 : day))
    const lastMonday = new Date(lastSunday)
    lastMonday.setDate(lastSunday.getDate() - 6)
    const format = (date: Date) => date.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })
    return `${format(lastMonday)}–${format(lastSunday)}`
}

export function RequestCallDialog({ clientTitle, pending, error, onClose, onSend }: {
    clientTitle: string
    pending: boolean
    error: string | null
    onClose: () => void
    onSend: (input: { serviceName: string; requirement: string }) => void
}) {
    const [serviceName, setServiceName] = useState("")
    const [requirement, setRequirement] = useState("")
    const valid = serviceName.trim().length > 0 && requirement.trim().length > 0
    function submit(event: FormEvent) {
        event.preventDefault()
        if (!valid || pending) return
        onSend({ serviceName: serviceName.trim(), requirement: requirement.trim() })
    }
    return <CenteredDialog title="Request a call" short onClose={onClose} busy={pending}>
        <form onSubmit={submit} className="space-y-4">
            <p className="text-sm leading-5 text-neutral-400">Sends an approved WhatsApp template to {clientTitle} asking them to reply CALL so you can arrange a call to complete a blocked step.</p>
            <label className="block text-sm text-neutral-300">Service or step<input value={serviceName} onChange={(event) => setServiceName(event.target.value)} maxLength={MAX_VARIABLE_LENGTH} placeholder="e.g. business phone setup" className={`mt-1 ${fieldClass}`} autoFocus /></label>
            <label className="block text-sm text-neutral-300">What the client needs to do<input value={requirement} onChange={(event) => setRequirement(event.target.value)} maxLength={MAX_VARIABLE_LENGTH} placeholder="e.g. verifying the business phone number" className={`mt-1 ${fieldClass}`} /></label>
            {error ? <p className="text-sm leading-5 text-red-300">{error}</p> : null}
            <Button type="submit" className="w-full" disabled={!valid || pending}>{pending ? "Sending…" : "Send call request"}</Button>
        </form>
    </CenteredDialog>
}

export function SendReportDialog({ clientTitle, pending, error, onClose, onSend }: {
    clientTitle: string
    pending: boolean
    error: string | null
    onClose: () => void
    onSend: (input: { period: string }) => void
}) {
    const [period, setPeriod] = useState(defaultReportPeriod)
    const valid = period.trim().length > 0
    function submit(event: FormEvent) {
        event.preventDefault()
        if (!valid || pending) return
        onSend({ period: period.trim() })
    }
    return <CenteredDialog title="Send weekly report" short onClose={onClose} busy={pending}>
        <form onSubmit={submit} className="space-y-4">
            <p className="text-sm leading-5 text-neutral-400">Sends an approved WhatsApp template to {clientTitle} letting them know their written report is ready and asking them to reply REPORT.</p>
            <label className="block text-sm text-neutral-300">Reporting period<input value={period} onChange={(event) => setPeriod(event.target.value)} maxLength={MAX_VARIABLE_LENGTH} placeholder="e.g. October 26–November 1, 2026" className={`mt-1 ${fieldClass}`} autoFocus /></label>
            {error ? <p className="text-sm leading-5 text-red-300">{error}</p> : null}
            <Button type="submit" className="w-full" disabled={!valid || pending}>{pending ? "Sending…" : "Send report notice"}</Button>
        </form>
    </CenteredDialog>
}
