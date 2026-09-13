"use client"
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, useTransition, type ComponentProps } from "react"
import dynamic from "next/dynamic"
import Link from "@/components/workspace/WorkspaceLink"
import { useRouter } from "@/components/workspace/WorkspaceNavigation"
import { DetailField, DetailFields, DetailPageHeader } from "@/components/detail"
import { AssignmentSelector, Selector, Status } from "@/components/ui"
import { List, ListItem, ListPrimaryRow, ListSecondaryRow, ListTitle } from "@/components/list/List"
import {
    sellRelationshipServices,
    retryServiceSaleConfirmation,
} from "@/app/[workspaceSlug]/relationships/service-sale-actions"
import { changeRelationshipService } from "@/app/[workspaceSlug]/relationships/service-actions"
import { runWorkspaceMutation } from "@/lib/workspace-mutations"
import { formatRelativeTime } from "@/lib/ui/relative-time"
import { postGanttSync } from "@/lib/ui/gantt-sync"
import {
    serviceSaleTotals,
    validServiceSaleInput,
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
    return (
        <label className="block min-w-0 text-xs text-neutral-400">
            {label}
            <input
                aria-label={label}
                className={`${inputClass} mt-1`}
                type="number"
                inputMode="decimal"
                min="0"
                max="999999.99"
                step="0.01"
                value={value / 100 || ""}
                placeholder="0.00"
                disabled={disabled}
                onChange={(e) => onChange(Math.round(Number(e.target.value) * 100))}
            />
        </label>
    )
}
export function RelationshipServicePos(props: Props) {
    const { workspaceSlug, relationshipId, userId, relationship } = props
    const router = useRouter()
    const endpoint = `/api/workspaces/${workspaceSlug}/relationships/${relationshipId}/pos`
    const servicesEndpoint = endpoint.replace(/\/pos$/, "/services")
    const storageKey = `be:service-pos:pending:${userId}:${workspaceSlug}:${relationshipId}`
    const [page, setPage] = useState(props.initial)
    const [draft, setInput] = useState<ServiceSaleInput>({
        relationshipVersion: relationship.updatedAt,
        managerId: relationship.managerId ?? "",
        billingInterval: "month",
        billingIntervalCount: 1,
        lines: [],
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
    const [reading, setReading] = useState(false)
    const [pending, startTransition] = useTransition()
    const guard = useRef(false)
    const generation = useRef(0)
    const [disposition, setDisposition] = useState<{
        row: ServicePosRow
        stage: "for_later" | "declined"
        reason: string
        requestId: string
        uncertain?: boolean
    } | null>(null)
    const locked = pending || reading || Boolean(recovery)
    const totals = serviceSaleTotals(page.items, input.lines)
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
                ? { billingInterval: row.billing_interval, billingIntervalCount: row.billing_interval_count }
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
                          recurringCents: row.recurring_cents,
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
            if (showPreview) setPreview(data.preview)
        } catch (e) {
            setError(e instanceof Error ? e.message : "Could not review this sale.")
        } finally {
            setReading(false)
        }
    }
    async function refresh() {
        const response = await fetch(endpoint, { headers: { "x-workspace-user": userId }, cache: "no-store" })
        const data = await response.json()
        if (!response.ok) throw new Error(data.error ?? "Reload the POS to see the saved sale.")
        setPage(data)
        setInput((v) => ({ ...v, relationshipVersion: data.relationshipVersion ?? v.relationshipVersion }))
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
                setInput((v) => ({ ...v, lines: [] }))
                setNotice(result.notice)
                await refresh()
            } catch {
                setError("The result could not be confirmed. Retry the same sale to recover its saved result.")
            } finally {
                guard.current = false
            }
        })
    }
    function deferService() {
        if (!disposition || guard.current) return
        guard.current = true
        setError("")
        startTransition(async () => {
            try {
                const result = await runWorkspaceMutation(() =>
                    changeRelationshipService(workspaceSlug, relationshipId, {
                        expectedUserId: userId,
                        requestId: disposition.requestId,
                        instanceId: disposition.row.id,
                        version: disposition.row.version,
                        stage: disposition.stage,
                        assigneeId: disposition.row.assignee_user_id ?? "",
                        reason: disposition.reason,
                    }),
                )
                if (!result.ok) {
                    setError(result.error ?? "Could not save the change.")
                    setDisposition((v) => (v ? { ...v, uncertain: result.uncertain } : null))
                    return
                }
                change({ ...input, lines: input.lines.filter((l) => l.id !== disposition.row.id) })
                setDisposition(null)
                await refresh()
            } catch {
                setDisposition((v) => (v ? { ...v, uncertain: true } : null))
                setError("Could not confirm the change. Retry this same change.")
            } finally {
                guard.current = false
            }
        })
    }
    return (
        <div className="mx-auto w-full min-w-0 max-w-6xl px-4 py-5 text-white sm:px-6">
            <Link
                href={`/${workspaceSlug}/relationships/${relationshipId}`}
                className="inline-flex min-h-11 items-center text-sm text-neutral-400 hover:text-white"
            >
                ← Relationship
            </Link>
            <DetailPageHeader
                reference={relationshipId.slice(0, 8)}
                updated={formatRelativeTime(relationship.updatedAt)}
                category="Point of sale"
                title={relationship.company ?? relationship.name}
                subtitle="Select Negotiating services to sell together."
            />
            <DetailFields>
                <DetailField label="Contact" icon="identity">
                    {relationship.name}
                </DetailField>
                <DetailField label="Billing email" icon="contact">
                    <span className="break-words">
                        {relationship.email ?? "Add an email in relationship information"}
                    </span>
                </DetailField>
                <DetailField label="Client number" icon="contact">
                    {relationship.phone ?? "Add a number in relationship information"}
                </DetailField>
                <DetailField label="Manager" icon="person">
                    <AssignmentSelector
                        value={input.managerId}
                        people={page.managers}
                        onChange={(id) => change({ ...input, managerId: id })}
                        ariaLabel="Sale manager"
                        placeholder="Choose manager"
                        disabled={locked}
                    />
                </DetailField>
            </DetailFields>
            <div className="mt-6 flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-semibold">Negotiating services</h2>
                <span className="text-sm text-neutral-500">{input.lines.length} selected</span>
            </div>
            <List ariaLabel="Negotiating services" className="!mt-3">
                {page.items.length ? (
                    page.items.map((row) => {
                        const line = input.lines.find((l) => l.id === row.id)
                        return (
                            <ListItem key={row.id}>
                                <ListPrimaryRow>
                                    <label className="flex min-h-9 min-w-0 flex-1 cursor-pointer items-center gap-3">
                                        <input
                                            type="checkbox"
                                            aria-label={`Select ${row.name}`}
                                            checked={Boolean(line)}
                                            disabled={locked || !ready || Boolean(disposition)}
                                            onChange={() => toggle(row)}
                                            className="h-5 w-5 shrink-0 accent-white"
                                        />
                                        <ListTitle>{row.name}</ListTitle>
                                    </label>
                                    <span className="shrink-0 text-xs text-neutral-500">{row.currency}</span>
                                </ListPrimaryRow>
                                {line ? (
                                    <div className="grid min-w-0 gap-3 px-3.5 py-3 sm:grid-cols-2 lg:grid-cols-3">
                                        <div className="min-w-0">
                                            <p className="mb-1 text-xs text-neutral-400">Service assignee</p>
                                            <AssigneeField
                                                endpoint={servicesEndpoint}
                                                row={row}
                                                value={line.assigneeId}
                                                onChange={(assigneeId) => patchLine(row.id, { assigneeId })}
                                                disabled={locked}
                                            />
                                        </div>
                                        <MoneyField
                                            label={`Upfront for ${row.name}`}
                                            value={line.upfrontCents}
                                            onChange={(upfrontCents) => patchLine(row.id, { upfrontCents })}
                                            disabled={locked}
                                        />
                                        {row.service_type === "retainer" ? (
                                            <MoneyField
                                                label={`Recurring for ${row.name}`}
                                                value={line.recurringCents}
                                                onChange={(recurringCents) => patchLine(row.id, { recurringCents })}
                                                disabled={locked}
                                            />
                                        ) : null}
                                    </div>
                                ) : (
                                    <ListSecondaryRow className="!flex-wrap !whitespace-normal">
                                        <span className="min-w-0 text-xs text-neutral-500">
                                            {money(row.upfront_cents, row.currency)} upfront
                                            {row.recurring_cents
                                                ? ` · ${money(row.recurring_cents, row.currency)} recurring`
                                                : ""}
                                        </span>
                                        <div className="ml-auto flex gap-3">
                                            {(["for_later", "declined"] as const).map((stage) => (
                                                <button
                                                    type="button"
                                                    key={stage}
                                                    disabled={locked || Boolean(disposition)}
                                                    className="min-h-9 text-xs text-neutral-400 underline underline-offset-4 disabled:opacity-40"
                                                    onClick={() =>
                                                        setDisposition({
                                                            row,
                                                            stage,
                                                            reason: "",
                                                            requestId: crypto.randomUUID(),
                                                        })
                                                    }
                                                >
                                                    {stage === "for_later" ? "For later" : "Declined"}
                                                </button>
                                            ))}
                                        </div>
                                    </ListSecondaryRow>
                                )}
                            </ListItem>
                        )
                    })
                ) : (
                    <p className="p-4 text-sm text-neutral-500">
                        No Negotiating services. Add or reopen a service on the relationship to prepare another sale.
                    </p>
                )}
            </List>
            {page.hasMore ? (
                <button
                    type="button"
                    className={`${secondary} mt-3`}
                    disabled={locked}
                    onClick={async () => {
                        setReading(true)
                        try {
                            const r = await fetch(`${endpoint}?offset=${page.items.length}`, {
                                headers: { "x-workspace-user": userId },
                                cache: "no-store",
                            })
                            const data = await r.json()
                            if (!r.ok) throw new Error(data.error)
                            setPage((p) => ({ ...p, items: [...p.items, ...data.items], hasMore: data.hasMore }))
                        } catch {
                            setError("Could not load more services. Try again.")
                        } finally {
                            setReading(false)
                        }
                    }}
                >
                    Load more services
                </button>
            ) : null}
            {disposition ? (
                <section className="mt-4 border-y border-neutral-800 py-4">
                    <h3 className="text-sm font-medium">
                        Move {disposition.row.name} to {disposition.stage === "for_later" ? "For later" : "Declined"}
                    </h3>
                    <label className="mt-3 block text-xs text-neutral-400">
                        Reason
                        <input
                            className={`${inputClass} mt-1`}
                            value={disposition.reason}
                            disabled={pending || disposition.uncertain}
                            maxLength={1000}
                            onChange={(e) => setDisposition({ ...disposition, reason: e.target.value })}
                        />
                    </label>
                    <div className="mt-3 flex gap-3">
                        <button
                            type="button"
                            className={secondary}
                            disabled={pending || disposition.uncertain}
                            onClick={() => setDisposition(null)}
                        >
                            Cancel
                        </button>
                        <button
                            type="button"
                            className={button}
                            disabled={pending || !disposition.reason.trim()}
                            onClick={deferService}
                        >
                            {disposition.uncertain ? "Retry same change" : "Save change"}
                        </button>
                    </div>
                </section>
            ) : null}
            {input.lines.length || recovery ? (
                <section className="mt-5 border-t border-neutral-800 pt-4" aria-label="Sale summary">
                    {totals.recurring > 0 ? (
                        <div className="mb-4 grid max-w-md grid-cols-[5rem_minmax(0,1fr)] items-center gap-3">
                            <label htmlFor="billing-count" className="text-sm text-neutral-400">
                                Bill every
                            </label>
                            <div className="grid grid-cols-[5rem_minmax(0,1fr)] gap-2">
                                <input
                                    id="billing-count"
                                    aria-label="Billing interval count"
                                    className={inputClass}
                                    type="number"
                                    min="1"
                                    max={
                                        input.billingInterval === "year"
                                            ? 3
                                            : input.billingInterval === "month"
                                              ? 36
                                              : 156
                                    }
                                    value={input.billingIntervalCount}
                                    disabled={locked}
                                    onChange={(e) => change({ ...input, billingIntervalCount: Number(e.target.value) })}
                                />
                                <Selector
                                    ariaLabel="Billing interval"
                                    appearance="input"
                                    disabled={locked}
                                    value={input.billingInterval}
                                    onChange={(v) =>
                                        change({ ...input, billingInterval: v as ServiceSaleInput["billingInterval"] })
                                    }
                                    options={[
                                        { value: "week", label: "Weeks" },
                                        { value: "month", label: "Months" },
                                        { value: "year", label: "Years" },
                                    ]}
                                />
                            </div>
                        </div>
                    ) : null}
                    {totals.mixedCurrencies ? (
                        <p className="text-sm text-amber-300">
                            Select services in one currency. Different currencies need separate sales.
                        </p>
                    ) : totals.currency ? (
                        <p className="text-lg font-medium">
                            {money(totals.upfront, totals.currency)} upfront
                            {totals.recurring
                                ? ` + ${money(totals.recurring, totals.currency)} every ${input.billingIntervalCount} ${input.billingInterval}${input.billingIntervalCount > 1 ? "s" : ""}`
                                : ""}
                        </p>
                    ) : null}
                    {recovery ? (
                        <div className="mt-3">
                            <p className="mb-3 text-sm text-amber-200">
                                A sale submission is pending. Recover this same sale before making changes.
                            </p>
                            <button type="button" disabled={pending || !ready} className={button} onClick={sell}>
                                {pending ? "Recovering…" : "Retry same sale"}
                            </button>
                        </div>
                    ) : quote ? (
                        <div className="mt-4 rounded-xl border border-neutral-700 p-4">
                            <h3 className="font-medium">Review sale</h3>
                            <p className="mt-1 text-sm text-neutral-400">{quote.lines.map((l) => l.name).join(", ")}</p>
                            <p className="mt-2 text-sm text-neutral-400">
                                {quote.modules.length} onboarding modules, with shared modules included once. The
                                selected services will move to Awaiting payment when you confirm.
                            </p>
                            <p className="mt-2 text-sm text-neutral-400">
                                {money(quote.upfrontTotal, quote.currency)} upfront
                                {quote.recurringTotal
                                    ? ` + ${money(quote.recurringTotal, quote.currency)} every ${quote.billingIntervalCount} ${quote.billingInterval}${quote.billingIntervalCount !== 1 ? "s" : ""}`
                                    : ""}
                            </p>
                            <div className="mt-4 flex flex-wrap gap-3">
                                <button
                                    type="button"
                                    className={secondary}
                                    disabled={locked}
                                    onClick={() => void readReview(true)}
                                >
                                    {reading ? "Loading preview…" : "Preview onboarding"}
                                </button>
                                <button
                                    type="button"
                                    className={button}
                                    disabled={locked || Boolean(disposition)}
                                    onClick={sell}
                                >
                                    Sell {quote.lines.length} selected{" "}
                                    {quote.lines.length === 1 ? "service" : "services"}
                                </button>
                            </div>
                        </div>
                    ) : (
                        <button
                            type="button"
                            className={`${button} mt-4`}
                            disabled={locked || !ready || totals.mixedCurrencies || Boolean(disposition)}
                            onClick={() => void readReview()}
                        >
                            {reading ? "Reviewing…" : "Review selected services"}
                        </button>
                    )}
                </section>
            ) : null}
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
    )
}
