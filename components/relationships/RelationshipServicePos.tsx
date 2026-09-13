"use client"
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, useTransition, type ComponentProps } from "react"
import dynamic from "next/dynamic"
import Link from "@/components/workspace/WorkspaceLink"
import { useRouter } from "@/components/workspace/WorkspaceNavigation"
import { DetailField, DetailFields } from "@/components/detail"
import { AssignmentSelector, Status, AttachmentCard, AttachmentCards, RoundPill } from "@/components/ui"
import { List, ListItem, ListPrimaryRow, ListSecondaryRow, ListTitle } from "@/components/list/List"
import {
    sellRelationshipServices,
    retryServiceSaleConfirmation,
} from "@/app/[workspaceSlug]/relationships/service-sale-actions"
import { ServiceThumbnail } from "./ServiceThumbnail"
import { ContactThumbnail } from "./RelationshipContactCards"
import { contactMethodName } from "@/lib/relationship-contacts"
import { runWorkspaceMutation } from "@/lib/workspace-mutations"
import { postGanttSync } from "@/lib/ui/gantt-sync"
import {
    serviceSaleTotals,
    validServiceSaleInput,
    validServiceSaleDraft,
    monthlyServicePrice,
    type ServicePosPage,
    type ServicePosRow,
    type ServiceSaleInput,
    type ServiceSaleLine,
    type ServiceSaleQuote,
} from "@/lib/service-pos"
import type { BuilderPreview as PreviewComponent } from "@/components/onboarding-builder/BuilderPreview"
const Preview = dynamic(() => import("@/components/onboarding-builder/BuilderPreview").then((m) => m.BuilderPreview))
const PreviewOverlay = dynamic(() =>
    import("@/components/onboarding-builder/OnboardingPreviewOverlay").then((m) => m.OnboardingPreviewOverlay),
)
const button =
    "inline-flex min-h-11 items-center justify-center rounded-lg bg-white px-4 py-2 text-sm font-medium text-black disabled:opacity-40"
const secondary =
    "inline-flex min-h-11 items-center justify-center rounded-lg border border-neutral-700 px-3 py-2 text-sm text-neutral-200 disabled:opacity-40"
const inputClass =
    "min-h-11 w-full min-w-0 rounded-lg border border-neutral-700 bg-black px-3 py-2 text-base text-white sm:text-sm"
const money = (cents: number, currency: string) =>
    new Intl.NumberFormat(undefined, { style: "currency", currency }).format(cents / 100)
const recoveryEvent = "be:service-pos:recovery-changed"
function subscribeToRecovery(onChange: () => void) {
    window.addEventListener("storage", onChange)
    window.addEventListener(recoveryEvent, onChange)
    return () => {
        window.removeEventListener("storage", onChange)
        window.removeEventListener(recoveryEvent, onChange)
    }
}
type PendingSale = { requestId: string; input: ServiceSaleInput; quoteHash: string }
type Props = {
    initialSelectionId?: string
    onBusyChange?: (busy: boolean) => void
    workspaceSlug: string
    relationshipId: string
    userId: string
    initial: ServicePosPage
    relationship: {
        name: string
        company: string | null
        email: string | null
        phone: string | null
        updatedAt: string
        managerId: string | null
    }
}
function AssigneeField({
    endpoint,
    row,
    value,
    onChange,
    disabled,
}: {
    endpoint: string
    row: ServicePosRow
    value: string
    onChange: (id: string) => void
    disabled: boolean
}) {
    const [people, setPeople] = useState<Array<{ id: string; name: string }> | null>(null)
    const [error, setError] = useState("")
    const [attempt, setAttempt] = useState(0)
    useEffect(() => {
        const controller = new AbortController()
        fetch(`${endpoint}?kind=assignees&service=${row.service_id}`, { signal: controller.signal, cache: "no-store" })
            .then(async (r) => {
                const data = await r.json()
                if (!r.ok) throw new Error(data.error ?? "Could not load people.")
                return data
            })
            .then(setPeople)
            .catch((e) => {
                if (!controller.signal.aborted) setError(e.message)
            })
        return () => controller.abort()
    }, [endpoint, row.service_id, attempt])
    return (
        <div>
            <AssignmentSelector
                value={value}
                people={people ?? []}
                onChange={onChange}
                disabled={disabled || !people || Boolean(error)}
                ariaLabel={`Assignee for ${row.name}`}
                title="Assign service"
                placeholder={people ? "Choose assignee" : "Loading people…"}
                appearance="input"
            />
            {error ? (
                <button
                    type="button"
                    className="mt-1 text-xs text-red-300 underline"
                    onClick={() => {
                        setError("")
                        setAttempt((v) => v + 1)
                    }}
                >
                    {error} Retry
                </button>
            ) : people && !people.length ? (
                <p className="mt-1 text-xs text-amber-300">Set eligible people in the service catalogue.</p>
            ) : null}
        </div>
    )
}
function MoneyField({
    label,
    value,
    onChange,
    disabled,
}: {
    label: string
    value: number
    onChange: (cents: number) => void
    disabled: boolean
}) {
    const [editing, setEditing] = useState<{ text: string; cents: number } | null>(null)
    return (
        <label className="block min-w-0 text-xs text-neutral-400">
            {label.split(" for ")[0]}
            <input
                aria-label={label}
                className={`${inputClass} mt-1`}
                type="text"
                inputMode="decimal"
                maxLength={14}
                value={editing?.cents === value ? editing.text : (value / 100).toFixed(2)}
                placeholder="0.00"
                disabled={disabled}
                onChange={(event) => {
                    const text = event.target.value
                    if (!/^\d*(?:\.\d{0,2})?$/.test(text)) return
                    const cents = Math.round(Number(text === "." ? "0" : text) * 100)
                    if (!Number.isSafeInteger(cents) || cents > 99999999) return
                    setEditing({ text, cents })
                    onChange(cents)
                }}
                onBlur={() => setEditing(null)}
                onKeyDown={event => { if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.blur() } }}
            />
        </label>
    )
}
export function RelationshipServicePos(props: Props) {
    const { workspaceSlug, relationshipId, userId, relationship, onBusyChange } = props
    const router = useRouter()
    const endpoint = `/api/workspaces/${workspaceSlug}/relationships/${relationshipId}/pos`
    const servicesEndpoint = endpoint.replace(/\/pos$/, "/services")
    const storageKey = `be:service-pos:pending:${userId}:${workspaceSlug}:${relationshipId}`
    const [page, setPage] = useState(props.initial)
    const [step, setStep] = useState(1)
    const draftKey = `be:service-pos:draft:${userId}:${workspaceSlug}:${relationshipId}`
    const [draft, setDraft] = useState<ServiceSaleInput>(() => {
        const initial: ServiceSaleInput = {
        relationshipVersion: relationship.updatedAt,
        managerId: relationship.managerId ?? "",
        billingInterval: "month",
        billingIntervalCount: 1,
        uiVersion: 2,
        offered: props.initial.items.map(row => ({ id: row.id, version: row.version })),
        delivery: [],
        lines: [],
        }
        try {
            const saved = JSON.parse(sessionStorage.getItem(draftKey) ?? "null") as ServiceSaleInput | null
            if (validServiceSaleDraft(saved, props.initial.items, initial.relationshipVersion)) Object.assign(initial, { lines: saved.lines, managerId: saved.managerId })
        } catch { /* A fresh form remains available when no saved draft can be read. */ }
        const selected = props.initial.items.find(row => row.id === props.initialSelectionId)
        if (selected && !initial.lines.some(line => line.id === selected.id)) initial.lines.push({ id: selected.id, version: selected.version, assigneeId: selected.assignee_user_id ?? "", upfrontCents: selected.upfront_cents, recurringCents: monthlyServicePrice(selected) })
        return initial
    })
    const [quote, setQuote] = useState<ServiceSaleQuote | null>(null)
    const [preview, setPreview] = useState<ComponentProps<typeof PreviewComponent> | null>(null)
    const recoverySnapshot = useSyncExternalStore(
        subscribeToRecovery,
        () => {
            try {
                return sessionStorage.getItem(storageKey) ?? ""
            } catch {
                return "unavailable"
            }
        },
        () => null,
    )
    const storedRecovery = useMemo(() => {
        if (!recoverySnapshot) return { value: null, error: "" }
        try {
            const value = JSON.parse(recoverySnapshot) as PendingSale
            if (
                !validServiceSaleInput(value.input) ||
                !/^[0-9a-f-]{36}$/i.test(value.requestId) ||
                !/^[0-9a-f]{64}$/.test(value.quoteHash)
            )
                throw new Error()
            return { value, error: "" }
        } catch {
            return {
                value: null,
                error: "Could not recover the pending sale. Check recent sales before opening a new POS tab.",
            }
        }
    }, [recoverySnapshot])
    const recovery = storedRecovery.value
    const input = recovery?.input ?? draft
    const ready = recoverySnapshot !== null && !storedRecovery.error
    function saveRecovery(value: PendingSale | null) {
        if (value) sessionStorage.setItem(storageKey, JSON.stringify(value))
        else sessionStorage.removeItem(storageKey)
        window.dispatchEvent(new Event(recoveryEvent))
    }
    const [error, setError] = useState("")
    const [notice, setNotice] = useState("")
    const [draftStorageError, setDraftStorageError] = useState("")
    const [reading, setReading] = useState(false)
    const [pending, startTransition] = useTransition()
    const guard = useRef(false)
    const generation = useRef(0)
    const locked = pending || reading || Boolean(recovery)
    const totals = serviceSaleTotals(page.items, input.lines)
    useEffect(() => { onBusyChange?.(pending || reading); return () => onBusyChange?.(false) }, [onBusyChange, pending, reading])
    const draftRef = useRef(draft)
    function setInput(next: ServiceSaleInput | ((current: ServiceSaleInput) => ServiceSaleInput)) {
        const value = typeof next === "function" ? next(draftRef.current) : next
        draftRef.current = value
        try { sessionStorage.setItem(draftKey, JSON.stringify(value)); setDraftStorageError("") }
        catch { setDraftStorageError("This browser could not save your draft. Keep this popup open until site storage is available.") }
        setDraft(value)
    }
    function change(next: ServiceSaleInput) {
        generation.current++
        setInput(
            next.lines.every((line) => line.recurringCents === 0)
                ? { ...next, billingInterval: "month", billingIntervalCount: 1 }
                : next,
        )
        setQuote(null)
        setPreview(null)
        setError("")
    }
    function patchLine(id: string, patch: Partial<ServiceSaleLine>) {
        change({ ...input, lines: input.lines.map((line) => (line.id === id ? { ...line, ...patch } : line)) })
    }
    function toggle(row: ServicePosRow) {
        const exists = input.lines.some((l) => l.id === row.id)
        if (!exists && input.lines.length >= 30) {
            setError("Select up to 30 services in one sale.")
            return
        }
        const firstRecurring = !input.lines.some((l) => l.recurringCents > 0) && row.recurring_cents > 0
        change({
            ...input,
            ...(!exists && firstRecurring
                ? { billingInterval: "month", billingIntervalCount: 1 }
                : {}),
            lines: exists
                ? input.lines.filter((l) => l.id !== row.id)
                : [
                      ...input.lines,
                      {
                          id: row.id,
                          version: row.version,
                          assigneeId: row.assignee_user_id ?? "",
                          upfrontCents: row.upfront_cents,
                          recurringCents: monthlyServicePrice(row),
                      },
                  ],
        })
    }
    async function readReview(showPreview = false) {
        if (guard.current || !validServiceSaleInput(input)) {
            setError("Choose a manager and an eligible assignee, and set a price for every selected service.")
            return
        }
        const revision = generation.current
        setReading(true)
        setError("")
        try {
            const response = await fetch(`${endpoint}${showPreview ? "?preview=1" : ""}`, {
                method: "POST",
                headers: { "Content-Type": "application/json", "x-workspace-user": userId },
                body: JSON.stringify(input),
                signal: AbortSignal.timeout(30000),
            })
            const data = await response.json()
            if (!response.ok) throw new Error(data.error ?? "Could not review this sale.")
            if (data.userId !== userId || data.relationshipId !== relationshipId)
                throw new Error("Your account changed. Reload the POS.")
            if (revision !== generation.current) return
            setQuote(data.quote)
            setStep(2)
            if (showPreview) setPreview(data.preview)
        } catch (e) {
            setError(e instanceof Error ? e.message : "Could not review this sale.")
        } finally {
            setReading(false)
        }
    }
    async function refresh() {
        const response = await fetch(endpoint, { headers: { "x-workspace-user": userId }, cache: "no-store", signal: AbortSignal.timeout(30000) })
        const data = await response.json()
        if (!response.ok) throw new Error(data.error ?? "Reload the POS to see the saved sale.")
        setPage(data)
        setInput((v) => ({ ...v, relationshipVersion: data.relationshipVersion ?? v.relationshipVersion, offered: data.items.map((row: ServicePosRow) => ({ id: row.id, version: row.version })) }))
        router.refresh()
        postGanttSync(workspaceSlug)
    }
    function sell() {
        if (guard.current || (!quote && !recovery) || !ready) return
        const request = recovery ?? { requestId: crypto.randomUUID(), input, quoteHash: quote!.hash }
        try {
            saveRecovery(request)
        } catch {
            setError("This browser could not save the recovery receipt. Enable site storage before selling.")
            return
        }
        guard.current = true
        setError("")
        startTransition(async () => {
            try {
                const result = await runWorkspaceMutation(() =>
                    sellRelationshipServices(workspaceSlug, relationshipId, { ...request, expectedUserId: userId }),
                )
                if (!result.ok) {
                    setError(result.error)
                    if (!result.uncertain) {
                        saveRecovery(null)
                        setQuote(null)
                    }
                    return
                }
                saveRecovery(null)
                setQuote(null)
                setInput((v) => ({ ...v, lines: [], delivery: [] }))
                setStep(1)
                setNotice(result.notice)
                await refresh()
            } catch {
                setError("The result could not be confirmed. Retry the same sale to recover its saved result.")
            } finally {
                guard.current = false
            }
        })
    }
    return <div className="min-w-0 text-white">
            {draftStorageError ? <p role="alert" className="mb-4 text-sm text-red-300">{draftStorageError}</p> : null}
            <ol aria-label="Sale steps" className="mb-5 flex gap-3 border-b border-neutral-800 pb-4 text-xs sm:gap-6 sm:text-sm">{["Services", "Onboarding", "Send link"].map((label, index) => <li key={label} aria-current={step === index + 1 ? "step" : undefined} className={step === index + 1 ? "font-semibold text-white" : "text-neutral-500"}>{index + 1}. {label}</li>)}</ol>
            {recovery ? <div className="mb-4 space-y-3 text-sm text-amber-200"><p>A sale submission is pending. Recover the same sale before making changes.</p><button disabled={pending || !ready} className={button} onClick={sell}>{pending ? "Recovering…" : "Retry same sale"}</button></div> : null}
            {step === 1 ? <>
                <p className="mb-4 text-sm text-neutral-400">Choose the services to sell together. Unchecked services become Declined only when the sale is saved, and can still be sold later.</p>
                <AttachmentCards label="Services to sell" selection>{page.items.map(row => {
                    const line = input.lines.find(line => line.id === row.id)
                    return <AttachmentCard key={row.id} title={row.name} thumbnail={<ServiceThumbnail service={row} />} selected={Boolean(line)} inactive={!line} onClick={() => toggle(row)} disabled={locked || !ready} subtitle={line ? "Selected" : row.stage === "declined" ? "Declined · available to sell" : "Select service"}>
                        {line ? <div className="grid min-w-0 grid-cols-2 gap-3"><MoneyField label={`Upfront for ${row.name}`} value={line.upfrontCents} onChange={upfrontCents => patchLine(row.id, { upfrontCents })} disabled={locked} />{row.service_type === "retainer" ? <MoneyField label={`Monthly for ${row.name}`} value={line.recurringCents} onChange={recurringCents => patchLine(row.id, { recurringCents })} disabled={locked} /> : null}<div className="col-span-2 min-w-0"><AssigneeField endpoint={servicesEndpoint} row={row} value={line.assigneeId} onChange={assigneeId => patchLine(row.id, { assigneeId })} disabled={locked} /></div></div> : <p className="text-xs text-neutral-500">{money(row.upfront_cents, row.currency)} upfront{row.recurring_cents ? ` + ${money(monthlyServicePrice(row), row.currency)} / month` : ""}</p>}
                    </AttachmentCard>
                })}</AttachmentCards>
                {!page.items.length ? <p className="py-4 text-sm text-neutral-400">Add a service from the relationship’s catalogue before selling.</p> : null}
                {page.hasMore ? <button className={`${secondary} mt-4`} disabled={locked || page.items.length >= 300} onClick={async () => {
                    setReading(true)
                    try { const response = await fetch(`${endpoint}?offset=${page.items.length}`, { headers: { "x-workspace-user": userId }, cache: "no-store", signal: AbortSignal.timeout(30000) }); const data = await response.json(); if (!response.ok) throw new Error(data.error); setPage(current => ({ ...current, items: [...current.items, ...data.items], hasMore: data.hasMore })); change({ ...input, offered: [...(input.offered ?? []), ...data.items.map((row: ServicePosRow) => ({ id: row.id, version: row.version }))] }) } catch { setError("Could not load the remaining services. Retry before continuing.") } finally { setReading(false) }
                }}>Load remaining services</button> : null}
                <DetailFields columns={1}><DetailField label="Manager" icon="person"><AssignmentSelector value={input.managerId} people={page.managers} onChange={managerId => change({ ...input, managerId })} disabled={locked} ariaLabel="Sale manager" placeholder="Choose manager" /></DetailField><DetailField label="Billing email" icon="contact">{relationship.email ?? "Add a billing email in Contact before selling"}</DetailField></DetailFields>
            </> : step === 2 ? <>
                <h3 className="mb-2 font-semibold">Review onboarding</h3><p className="text-sm leading-6 text-neutral-400">One link will include checkout and the onboarding modules required by these services.</p>
                <div role="list" aria-label="Included onboarding modules" className="mt-4 flex flex-wrap gap-2">{quote?.modules.map(module => <span role="listitem" key={module.module_id} title={module.mandatory ? "Shared information" : "Selected service"}><RoundPill tone="sky">{String(module.definition.name ?? module.code)}</RoundPill></span>)}</div>
                <button className={`${secondary} mt-4`} disabled={locked} onClick={() => void readReview(true)}>{reading ? "Opening preview…" : "Preview onboarding"}</button>
            </> : <>
                <h3 className="mb-2 font-semibold">Send their onboarding link</h3><p className="mb-4 text-sm leading-6 text-neutral-400">Choose confirmed contact methods. Each selected method receives the same onboarding link.</p>
                <AttachmentCards label="Onboarding delivery methods">{(page.contacts ?? []).filter(choice => choice.added).map(choice => <AttachmentCard key={choice.provider} title={contactMethodName(choice.provider)} thumbnail={<ContactThumbnail method={choice.provider} />} subtitle={choice.state === "active" ? choice.canSend ? choice.address : "Client reply needed" : choice.state === "broken" ? "Needs attention" : "Confirmation required"} selected={input.delivery?.some(selected => selected.provider === choice.provider)} inactive={choice.state !== "active" || !choice.canSend} broken={choice.state === "broken"} disabled={locked || choice.state !== "active" || !choice.canSend} onClick={() => setInput(current => ({ ...current, delivery: current.delivery?.some(selected => selected.provider === choice.provider) ? current.delivery.filter(selected => selected.provider !== choice.provider) : [...(current.delivery ?? []), { provider: choice.provider, address: choice.address }] }))} />)}</AttachmentCards>
                {!(page.contacts ?? []).some(choice => choice.state === "active" && choice.canSend && choice.added) ? <p className="mt-3 text-sm text-neutral-400">Confirm a WhatsApp or Twilio contact from the relationship before selling. Email and phone cards also offer direct email and calling.</p> : null}
                <button className="mt-2 min-h-11 text-sm text-neutral-300 underline" disabled={locked} onClick={async () => { try { const response = await fetch(endpoint, { headers: { "x-workspace-user": userId }, cache: "no-store", signal: AbortSignal.timeout(30000) }); const value = await response.json(); if (!response.ok) throw new Error(); setPage(current => ({ ...current, contacts: value.contacts })) } catch { setError("Could not check contact methods. Try again.") } }}>Refresh contact methods</button>
            </>}
            {totals.currency && input.lines.length ? <p className="mt-5 border-t border-neutral-800 pt-4 text-sm font-semibold">{money(totals.upfront, totals.currency)} upfront{totals.recurring ? ` + ${money(totals.recurring, totals.currency)} / month` : ""}</p> : null}
            {totals.mixedCurrencies ? <p className="mt-3 text-sm text-amber-300">Sell services in different currencies separately.</p> : null}
            {!recovery ? <div className="mt-4 flex items-center justify-between gap-3">{step > 1 ? <button className={secondary} disabled={locked} onClick={() => setStep(step - 1)}>Back</button> : <span />}{step === 1 ? <button className={button} disabled={locked || !ready || !input.lines.length || page.hasMore || totals.mixedCurrencies} onClick={() => void readReview()}>{reading ? "Reviewing…" : "Review onboarding"}</button> : step === 2 ? <button className={button} disabled={locked || !quote} onClick={() => setStep(3)}>Choose contact methods</button> : <button className={button} disabled={locked || !quote || !input.delivery?.length} onClick={sell}>{pending ? "Saving sale…" : `Sell ${input.lines.length === 1 ? "service" : `${input.lines.length} services`} & send link`}</button>}</div> : null}
            {error || storedRecovery.error ? (
                <p role="alert" className="mt-4 text-sm text-red-300">
                    {error || storedRecovery.error}
                </p>
            ) : null}
            {notice ? (
                <p role="status" className="mt-4 text-sm text-emerald-300">
                    {notice}
                </p>
            ) : null}
            {page.sales.length ? (
                <section className="mt-7">
                    <h2 className="font-semibold">Recent sales</h2>
                    <List ariaLabel="Recent service sales" className="!mt-3">
                        {page.sales.map((sale) => (
                            <ListItem key={sale.id}>
                                <ListPrimaryRow>
                                    <ListTitle>{sale.services.map((s) => s.name).join(", ")}</ListTitle>
                                </ListPrimaryRow>
                                <ListSecondaryRow className="!flex-wrap !whitespace-normal">
                                    <span className="text-xs text-neutral-400">
                                        {money(sale.upfront_total_amount, sale.currency)} upfront
                                        {sale.recurring_total_amount
                                            ? ` + ${money(sale.recurring_total_amount, sale.currency)} recurring`
                                            : ""}
                                    </span>
                                    <Status
                                        label={
                                            sale.status === "paid" || sale.status === "test_paid"
                                                ? "Paid"
                                                : sale.status === "payment_failed"
                                                  ? "Payment failed"
                                                  : sale.status.endsWith("_failed")
                                                    ? "Delivery needs attention"
                                                    : sale.consent_confirmed_at
                                                      ? "Awaiting payment"
                                                      : "Awaiting confirmation"
                                        }
                                        tone={
                                            sale.status === "paid" || sale.status === "test_paid"
                                                ? "green"
                                                : sale.status.endsWith("_failed")
                                                  ? "red"
                                                  : "yellow"
                                        }
                                    />
                                    <button
                                        type="button"
                                        disabled={locked}
                                        className="ml-auto min-h-9 text-xs text-neutral-300 underline"
                                        onClick={() =>
                                            startTransition(async () => {
                                                try {
                                                    const result = await runWorkspaceMutation(() =>
                                                        retryServiceSaleConfirmation(
                                                            workspaceSlug,
                                                            relationshipId,
                                                            sale.id,
                                                            userId,
                                                        ),
                                                    )
                                                    if (!result.ok)
                                                        setError("error" in result ? result.error : "Could not retry.")
                                                    else
                                                        setNotice(
                                                            "notice" in result ? result.notice : "Delivery checked.",
                                                        )
                                                } catch {
                                                    setError("Could not retry delivery.")
                                                }
                                            })
                                        }
                                    >
                                        {sale.consent_confirmed_at ? "Retry link delivery" : "Retry confirmation"}
                                    </button>
                                    {sale.consent_confirmed_at ? (
                                        <Link
                                            href={`/${workspaceSlug}/onboarding/${relationshipId}?session=${sale.onboarding_session_id}`}
                                            className="min-h-9 content-center text-xs underline"
                                        >
                                            Open onboarding
                                        </Link>
                                    ) : null}
                                </ListSecondaryRow>
                            </ListItem>
                        ))}
                    </List>
                </section>
            ) : null}
            {preview ? (
                <PreviewOverlay open onClose={() => setPreview(null)}>
                    <Preview {...preview} fullWindow />
                </PreviewOverlay>
            ) : null}
        </div>
}
