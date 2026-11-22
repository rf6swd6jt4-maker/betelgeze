"use client"

import { useState, useTransition, type FormEvent } from "react"
import { useRouter } from "@/components/workspace/WorkspaceNavigation"
import { Button, CenteredDialog } from "@/components/ui"
import { DetailDangerButton } from "@/components/detail"
import { runWorkspaceMutation } from "@/lib/workspace-mutations"
import {
    addSmsNumbersAction, connectSignalHouseAction, disconnectSignalHouseAction, labelSmsNumberAction, removeSmsNumberAction, sendTestTextAction, syncSignalHouseAction,
} from "@/app/[workspaceSlug]/settings/signalhouse/actions"

/** The same face as the Selector's input appearance, so fields line up with choices. */
export const signalHouseInputClass = "h-10 w-full min-w-0 rounded-lg border border-neutral-700 bg-black px-3 text-sm text-neutral-100 outline-none placeholder:text-neutral-600 hover:border-neutral-500 focus:border-neutral-400"

/** Runs one command, then stays busy until the refreshed page arrives, so a removed control cannot be pressed twice. */
function useAction() {
    const router = useRouter()
    const [sending, setSending] = useState(false)
    const [refreshing, startRefresh] = useTransition()
    const [error, setError] = useState<string | null>(null)
    async function run(command: () => Promise<{ ok: boolean; error?: string }>, onDone?: () => void) {
        setSending(true); setError(null)
        try {
            const result = await runWorkspaceMutation(command)
            if (!result.ok) setError(result.error ?? "Could not save. Please retry.")
            else { onDone?.(); startRefresh(() => router.refresh()) }
            return result.ok
        } catch {
            setError("Could not save. Please retry.")
            return false
        } finally {
            setSending(false)
        }
    }
    return { run, pending: sending || refreshing, error }
}

export function SignalHouseConnectForm({ workspaceSlug, compact = false }: { workspaceSlug: string; compact?: boolean }) {
    const { run, pending, error } = useAction()
    const [groupId, setGroupId] = useState("")
    const [apiKey, setApiKey] = useState("")
    function submit(event: FormEvent) {
        event.preventDefault()
        void run(() => connectSignalHouseAction(workspaceSlug, apiKey, groupId), () => setApiKey(""))
    }
    return <form onSubmit={submit} className="flex max-w-xl flex-col gap-3">
        <label className="flex flex-col gap-1.5 text-sm text-neutral-400">Group ID
            <input className={`${signalHouseInputClass} font-mono sm:max-w-48`} value={groupId} onChange={event => setGroupId(event.target.value.trim())} placeholder="G1234567" maxLength={8} autoComplete="off" spellCheck={false} required />
        </label>
        <label className="flex flex-col gap-1.5 text-sm text-neutral-400">API key
            <input className={`${signalHouseInputClass} font-mono`} type="password" value={apiKey} onChange={event => setApiKey(event.target.value)} autoComplete="new-password" spellCheck={false} required />
            <span className="text-xs leading-5 text-neutral-500">A service user key for this group, made in SignalHouse under Settings, API keys. It is encrypted before it is stored and never shown again.</span>
        </label>
        {error ? <p role="alert" className="text-sm text-red-300">{error}</p> : null}
        <div><Button type="submit" size={compact ? "sm" : "md"} disabled={pending || !groupId || !apiKey}>{pending ? "Connecting…" : "Connect SignalHouse"}</Button></div>
        <p className="text-xs leading-5 text-neutral-500">Connecting reads the account&apos;s 10DLC registrations and numbers and adds one signed webhook in SignalHouse, so replies and delivery receipts reach Betelgeze.</p>
    </form>
}

export function SignalHouseAccountActions({ workspaceSlug, accountId }: { workspaceSlug: string; accountId: string }) {
    const { run, pending, error } = useAction()
    const [confirm, setConfirm] = useState(false)
    return <span className="flex flex-wrap items-center justify-end gap-2">
        {error ? <span role="alert" className="text-xs text-red-300">{error}</span> : null}
        <Button size="sm" variant="secondary" disabled={pending} onClick={() => void run(() => syncSignalHouseAction(workspaceSlug, accountId))}>{pending && !confirm ? "Reading…" : "Read again"}</Button>
        {confirm ? <>
            <span className="text-sm text-neutral-400">Disconnect? Campaigns stop texting from its numbers.</span>
            <Button size="sm" variant="destructive" disabled={pending} onClick={() => void run(() => disconnectSignalHouseAction(workspaceSlug, accountId))}>Disconnect</Button>
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => setConfirm(false)}>Keep it</Button>
        </> : <Button size="sm" variant="ghost" disabled={pending} onClick={() => setConfirm(true)}>Disconnect</Button>}
    </span>
}

export type AvailableNumber = { id: string; phone: string; registration: string; ready: boolean }

export function AddSmsNumbers({ workspaceSlug, available }: { workspaceSlug: string; available: AvailableNumber[] }) {
    const { run, pending, error } = useAction()
    const [open, setOpen] = useState(false)
    const [picked, setPicked] = useState<string[]>([])
    return <>
        <Button size="sm" disabled={!available.length} title={available.length ? undefined : "Every number in the account is already added"} onClick={() => { setPicked(available.map(item => item.id)); setOpen(true) }}>Add numbers</Button>
        {open ? <CenteredDialog title="Add numbers from SignalHouse" busy={pending} onClose={() => setOpen(false)} footer={<div className="flex flex-wrap items-center gap-2">
            <Button size="sm" disabled={pending || !picked.length} onClick={() => void run(() => addSmsNumbersAction(workspaceSlug, picked), () => setOpen(false))}>{pending ? "Adding…" : picked.length > 1 ? `Add ${picked.length} numbers` : "Add number"}</Button>
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => setOpen(false)}>Cancel</Button>
            {error ? <span role="alert" className="text-xs text-red-300">{error}</span> : null}
        </div>}>
            <p className="text-sm text-neutral-400">These numbers are in the connected account and not used here yet. Buy and register numbers in SignalHouse; they appear here after the next read.</p>
            <div className="mt-3 flex flex-col">{available.map(item => <label key={item.id} className="flex min-h-11 cursor-pointer items-center gap-3 border-t border-card-border px-1 text-sm first:border-t-0">
                <input type="checkbox" className="h-4 w-4 accent-[var(--color-accent)]" checked={picked.includes(item.id)} onChange={event => setPicked(current => event.target.checked ? [...current, item.id] : current.filter(id => id !== item.id))} />
                <span className="tabular-nums text-neutral-100">{item.phone}</span>
                <span className="ml-auto truncate text-xs text-neutral-500">{item.ready ? item.registration : "Waiting on registration"}</span>
            </label>)}</div>
        </CenteredDialog> : null}
    </>
}

export function SmsNumberLabelField({ workspaceSlug, numberId, label }: { workspaceSlug: string; numberId: string; label: string }) {
    const { run, error } = useAction()
    const [value, setValue] = useState(label)
    const [saved, setSaved] = useState(false)
    return <div className="flex max-w-sm flex-col gap-1.5">
        <input className={signalHouseInputClass} aria-label="Label" value={value} maxLength={60} placeholder="For example, Dallas local" onChange={event => { setValue(event.target.value); setSaved(false) }}
            onBlur={() => { if (value.trim() !== label) void run(() => labelSmsNumberAction(workspaceSlug, numberId, value), () => setSaved(true)) }} />
        <p role="status" aria-live="polite" className={`min-h-4 text-xs ${error ? "text-red-300" : "text-neutral-500"}`}>{error ?? (saved ? "Saved" : "")}</p>
    </div>
}

export function SmsTestTextForm({ workspaceSlug, numberId, disabledReason }: { workspaceSlug: string; numberId: string; disabledReason: string | null }) {
    const { run, pending, error } = useAction()
    const [to, setTo] = useState("")
    const [sent, setSent] = useState(false)
    if (disabledReason) return <p className="text-sm text-neutral-500">{disabledReason}</p>
    return <form className="flex max-w-xl flex-col gap-2" onSubmit={event => { event.preventDefault(); setSent(false); void run(() => sendTestTextAction(workspaceSlug, numberId, to), () => setSent(true)) }}>
        <div className="flex flex-wrap items-center gap-2">
            <div className="min-w-0 flex-1 sm:max-w-56"><input className={signalHouseInputClass} inputMode="tel" aria-label="Your mobile number" placeholder="Your mobile number" value={to} onChange={event => setTo(event.target.value)} required /></div>
            <Button type="submit" size="sm" variant="secondary" disabled={pending || !to}>{pending ? "Sending…" : "Send a test text"}</Button>
        </div>
        <p role="status" aria-live="polite" className={`text-xs ${error ? "text-red-300" : "text-neutral-500"}`}>{error ?? (sent ? "Sent. It should arrive within a minute." : "Sends “Test text from Betelgeze. Reply STOP to opt out.”")}</p>
    </form>
}

export function RemoveSmsNumberButton({ workspaceSlug, numberId, blockedReason }: { workspaceSlug: string; numberId: string; blockedReason: string | null }) {
    const { run, pending, error } = useAction()
    const router = useRouter()
    return <span className="flex flex-col items-start gap-1 sm:items-end">
        <DetailDangerButton type="button" disabled={pending || Boolean(blockedReason)} title={blockedReason ?? undefined}
            onClick={() => void run(() => removeSmsNumberAction(workspaceSlug, numberId), () => router.push(`/${workspaceSlug}/settings/signalhouse`))}>{pending ? "Removing…" : "Remove from Betelgeze"}</DetailDangerButton>
        {error ? <span role="alert" className="text-xs text-red-300">{error}</span> : null}
    </span>
}
