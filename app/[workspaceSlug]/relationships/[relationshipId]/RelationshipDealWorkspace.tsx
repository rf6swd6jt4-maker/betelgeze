"use client"

import { Suspense, use, useCallback, useEffect, useState, useSyncExternalStore, useTransition } from "react"
import { createPortal } from "react-dom"
import { useRouter } from "@/components/workspace/WorkspaceNavigation"
import Image from "next/image"
import { OnboardingPreviewOverlay } from "@/components/onboarding-builder/OnboardingPreviewOverlay"
import { BuilderPreview } from "@/components/onboarding-builder/BuilderPreview"
import { DetailContentLoading, DetailField, DetailFields } from "@/components/detail"
import { Assignee, AssignmentSelector, CommunicationMethodSelector, RoundPill, Selector, SquarePill } from "@/components/ui"
import { useWorkspaceTabActive } from "@/components/workspace/useWorkspaceTabActive"
import { WorkspaceSuccessNotice } from "@/components/workspace/WorkspaceSuccessNotice"
import type { OnboardingPaymentDefinitionV2 } from "@/lib/onboarding/block-definition"
import type { OnboardingHelpSettings, OnboardingModuleDefinition, OnboardingThemeDefinition } from "@/lib/onboarding/configuration-types"
import type { RelationshipPhase } from "@/lib/relationship-phases"
import type { RelationshipGanttPlan } from "@/lib/relationship-gantt"
import { postGanttSync } from "@/lib/ui/gantt-sync"
import { registerWorkspaceAutosaveFlusher, runWorkspaceMutation } from "@/lib/workspace-mutations"
import { isUsablePhoneNumber, resolvePrimaryMessagingProvider } from "@/lib/client-messages/addresses"
import { beginRelationshipPos, proceedRelationshipCurrentWork, saveRelationshipBackgroundDetails, saveRelationshipDealDetails, type RelationshipDealDetailsInput } from "../actions"
import { RelationshipDraftQueue } from "@/lib/relationship-draft-queue"
import { getRelationshipDraftQueue, retainRelationshipDraftQueue } from "@/lib/relationship-draft-runtime"
import { createRelationshipDraftStorage, sendRelationshipBackgroundCommand, type RelationshipDraft as Draft } from "@/lib/relationship-draft-command"
import { RelationshipGantt } from "./RelationshipGantt"

type Member = { id: string; name: string; avatarSrc?: string | null }
type DealService = {
    code: string
    serviceId: string | null
    revisionId: string | null
    name: string
    description: string
    serviceType: "one_time" | "retainer"
    recurringName: string
    recurringDescription: string
    defaultBillingInterval: "week" | "month" | "year"
    defaultBillingIntervalCount: number
    thumbnailUrl: string | null
    defaultUpfrontPriceCents: number
    defaultRecurringPriceCents: number
    currency: string
    isTest: boolean
    revisionNumber: number | null
    selected: boolean
    selectedUpfrontPriceCents: number
    selectedRecurringPriceCents: number
    selectedCurrency: string
    selectedAssigneeId: string | null
    moduleIds: string[]
}
type RelationshipDetails = {
    primaryPersonName: string
    businessName: string
    primaryContactRole: string
    primaryPhone: string
    whatsappPhone: string
    communicationPrimaryProvider: "meta_whatsapp" | "twilio_sms"
    communicationDeliveryMode: "primary_only" | "primary_with_fallback" | "mirror"
    primaryEmail: string
    sellerUserId: string
    fulfilmentManagerUserId: string
    fulfilmentTeamId: string
    projectTimeframeDays: number | null
    description: string
    lifecyclePhase: RelationshipPhase
}
type CurrentWork = { id: string; title: string; action: string | null; role: string; status: string; unassignedCount: number; blocked: boolean }

const inputClass = "min-h-7 w-full min-w-0 bg-transparent text-sm text-neutral-200 outline-none placeholder:text-neutral-700 focus:text-white"

function missingText(value: string, message: string) {
    return value.trim() ? null : message
}

function emailIssue(value: string) {
    if (!value.trim()) return "Billing email required"
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()) ? null : "Enter a usable billing email"
}

function phoneIssue(value: string, label: string) {
    if (!value.trim()) return null
    return isUsablePhoneNumber(value) ? null : `Enter a usable ${label} number`
}

function messagingPhoneIssue(smsPhone: string, whatsappPhone: string) {
    return isUsablePhoneNumber(smsPhone) || isUsablePhoneNumber(whatsappPhone)
        ? null
        : "Add an SMS or WhatsApp number"
}

function priceLabel(cents: number, currency: string) {
    try {
        return new Intl.NumberFormat("en-IE", { style: "currency", currency: currency.toUpperCase() }).format(cents / 100)
    } catch {
        return `${currency.toUpperCase()} ${(cents / 100).toFixed(2)}`
    }
}

function intervalCountMaximum(interval: Draft["billingInterval"]) {
    return interval === "year" ? 3 : interval === "month" ? 36 : 156
}

function buildInitialDraft(details: RelationshipDetails, services: DealService[]): Draft {
    const selected = services.filter((service) => service.selected)
    const defaultRetainer = selected.find((service) => service.serviceType === "retainer")
        ?? services.find((service) => service.serviceType === "retainer")
    return {
        primaryPersonName: details.primaryPersonName,
        businessName: details.businessName,
        primaryContactRole: details.primaryContactRole,
        primaryPhone: details.primaryPhone,
        whatsappPhone: details.whatsappPhone,
        communicationPrimaryProvider: resolvePrimaryMessagingProvider({
            requestedProvider: details.communicationPrimaryProvider,
            smsPhone: details.primaryPhone,
            whatsappPhone: details.whatsappPhone,
        }),
        communicationDeliveryMode: details.communicationDeliveryMode,
        primaryEmail: details.primaryEmail,
        sellerUserId: details.sellerUserId,
        fulfilmentManagerUserId: details.fulfilmentManagerUserId,
        fulfilmentTeamId: details.fulfilmentTeamId,
        projectTimeframeDays: details.projectTimeframeDays,
        description: details.description,
        serviceAssignees: Object.fromEntries(services.map((service) => [service.code, service.selectedAssigneeId ?? ""])),
        selectedCodes: selected.map((service) => service.code),
        upfrontPrices: Object.fromEntries(services.map((service) => [service.code, service.selected ? service.selectedUpfrontPriceCents : service.defaultUpfrontPriceCents])),
        recurringPrices: Object.fromEntries(services.map((service) => [service.code, service.serviceType === "retainer" ? (service.selected ? service.selectedRecurringPriceCents : service.defaultRecurringPriceCents) : 0])),
        currency: selected[0]?.selectedCurrency ?? services[0]?.currency ?? "USD",
        billingInterval: defaultRetainer?.defaultBillingInterval ?? "month",
        billingIntervalCount: defaultRetainer?.defaultBillingIntervalCount ?? 1,
    }
}

function backgroundDetailsKey(draft: Draft) {
    return JSON.stringify({
        primaryPersonName: draft.primaryPersonName,
        businessName: draft.businessName,
        primaryContactRole: draft.primaryContactRole,
        primaryPhone: draft.primaryPhone,
        whatsappPhone: draft.whatsappPhone,
        communicationPrimaryProvider: draft.communicationPrimaryProvider,
        communicationDeliveryMode: draft.communicationDeliveryMode,
        primaryEmail: draft.primaryEmail,
        description: draft.description,
    })
}

function commercialDetailsKey(draft: Draft) {
    return JSON.stringify({
        sellerUserId: draft.sellerUserId,
        fulfilmentManagerUserId: draft.fulfilmentManagerUserId,
        serviceAssignees: draft.serviceAssignees,
        projectTimeframeDays: draft.projectTimeframeDays,
        selectedCodes: draft.selectedCodes,
        upfrontPrices: draft.upfrontPrices,
        recurringPrices: draft.recurringPrices,
        currency: draft.currency,
        billingInterval: draft.billingInterval,
        billingIntervalCount: draft.billingIntervalCount,
    })
}

function MissingHint({ message }: { message: string | null }) {
    return message ? <span className="mt-1 block text-[11px] text-amber-300">{message}</span> : null
}

function RelationshipGanttContent({ workspaceSlug, relationshipId, planPromise, canEdit, currentWork, userId, onInvoiceRequest }: {
    workspaceSlug: string
    relationshipId: string
    planPromise: Promise<RelationshipGanttPlan>
    canEdit: boolean
    currentWork: CurrentWork | null
    userId: string
    onInvoiceRequest: () => void
}) {
    const plan = use(planPromise)
    const fallbackCurrentWork = plan.items.find((item) => (
        item.workflowRole === "lifecycle_stage"
        && !["done", "canceled"].includes(item.status)
        && item.assignees.some((assignee) => assignee.userId === userId)
    ))
    const resolvedCurrentWork = currentWork ?? (fallbackCurrentWork ? {
        id: fallbackCurrentWork.id,
        title: fallbackCurrentWork.title,
        action: fallbackCurrentWork.workflowAction,
        role: fallbackCurrentWork.workflowRole,
        status: fallbackCurrentWork.status,
        unassignedCount: 0,
        blocked: false,
    } : null)

    return <RelationshipGantt workspaceSlug={workspaceSlug} relationshipId={relationshipId} userId={userId} plan={plan} canEdit={canEdit} currentWork={resolvedCurrentWork} onInvoiceRequest={onInvoiceRequest} />
}

export function RelationshipDealWorkspace({
    workspaceSlug,
    backgroundCommandsEnabled = false,
    workspaceName,
    logoSrc,
    privacyPolicyUrl,
    termsOfServiceUrl,
    relationshipId,
    userId,
    updatedAt,
    details,
    members,
    managers,
    eligibleUsers,
    canSell,
    services,
    modules,
    payment,
    theme,
    help,
    schemaReady,
    whatsappVerified,
    twilioVerified,
    commercialLocked,
    planPromise,
    canEdit,
    currentWork,
}: {
    workspaceSlug: string
    backgroundCommandsEnabled?: boolean
    workspaceName: string
    logoSrc?: string | null
    privacyPolicyUrl?: string | null
    termsOfServiceUrl?: string | null
    relationshipId: string
    userId: string
    updatedAt: string
    details: RelationshipDetails
    members: Member[]
    managers: Member[]
    eligibleUsers: Record<string, string[]>
    canSell: boolean
    services: DealService[]
    modules: OnboardingModuleDefinition[]
    payment: OnboardingPaymentDefinitionV2
    theme: OnboardingThemeDefinition
    help: OnboardingHelpSettings
    schemaReady: boolean
    whatsappVerified: boolean
    twilioVerified: boolean
    commercialLocked: boolean
    planPromise: Promise<RelationshipGanttPlan>
    canEdit: boolean
    currentWork: CurrentWork | null
}) {
    const router = useRouter()
    const workspaceTabActive = useWorkspaceTabActive()
    const runtimeKey = `${userId}:${workspaceSlug}:${relationshipId}`
    const [queue] = useState(() => getRelationshipDraftQueue(runtimeKey, () => new RelationshipDraftQueue(buildInitialDraft(details, services), updatedAt, async (command) => {
        if (!canEdit) return { ok: false, error: "You no longer have permission to save this relationship. Your draft is preserved." }
        if (!navigator.onLine) throw new Error("Saved on this device. Relationship details will retry when connected.")
        if (command.transport === "action") {
            const result = await runWorkspaceMutation(() => saveRelationshipBackgroundDetails(workspaceSlug, relationshipId, { ...command.values, expectedUpdatedAt: command.version, expectedUserId: userId }), { category: "services" })
            return result.ok ? { ...result, values: command.values } : result
        }
        return runWorkspaceMutation(() => sendRelationshipBackgroundCommand(workspaceSlug, relationshipId, { requestId: command.requestId, expectedUserId: userId, expectedUpdatedAt: command.version, values: command.values }), { category: "services" })
    }, backgroundCommandsEnabled ? "command" : "action")))
    const snapshot = useSyncExternalStore(queue.subscribe, queue.getSnapshot, queue.getSnapshot)
    const { draft, baseline } = snapshot
    const setDraft = queue.edit
    const [servicesOpen, setServicesOpen] = useState(false)
    const [invoiceOpen, setInvoiceOpen] = useState(false)
    const [invoiceStep, setInvoiceStep] = useState(0)
    const [onboardingPreviewOpen, setOnboardingPreviewOpen] = useState(false)
    const [actionError, setError] = useState<string | null>(null)
    const error = actionError ?? snapshot.error ?? snapshot.storageError
    const [notice, setNotice] = useState<{ label: string } | null>(null)
    const autosaveState = snapshot.error || snapshot.storageError ? "error" : snapshot.saving ? "saving" : "saved"
    const [pending, startTransition] = useTransition()
    const parentDocument = typeof window !== "undefined" && window.parent !== window ? window.parent.document : typeof document !== "undefined" ? document : null
    const selectedServices = services.filter((service) => draft.selectedCodes.includes(service.code))
    const selectedModuleIds = new Set([
        ...modules.filter((module) => module.mandatory).map((module) => module.id),
        ...selectedServices.flatMap((service) => service.moduleIds),
    ])
    // Published configuration is already in canonical composition order. Filtering
    // it preserves the same module sequence that a newly created session receives.
    const assignedModules = modules.filter((module) => selectedModuleIds.has(module.id))
    const primaryMessagingProvider = resolvePrimaryMessagingProvider({
        requestedProvider: draft.communicationPrimaryProvider,
        smsPhone: draft.primaryPhone,
        whatsappPhone: draft.whatsappPhone,
    })
    const smsPhoneAvailable = isUsablePhoneNumber(draft.primaryPhone)
    const whatsappPhoneAvailable = isUsablePhoneNumber(draft.whatsappPhone)
    const saleUsesSms = twilioVerified && smsPhoneAvailable && (
        primaryMessagingProvider === "twilio_sms" || draft.communicationDeliveryMode === "mirror"
    )
    const sendConfirmationLabel = `Send ${primaryMessagingProvider === "twilio_sms" ? "SMS" : "WhatsApp"} confirmation`
    const invoiced = ["sold", "invoiced", "onboarding", "onboarding_review", "fulfilment", "retention", "completed_lost"].includes(details.lifecyclePhase)
    const backgroundDirty = backgroundDetailsKey(draft) !== backgroundDetailsKey(baseline)
    const commercialDirty = commercialDetailsKey(draft) !== commercialDetailsKey(baseline)
    const relationshipIssues = [
        missingText(draft.primaryPersonName, "Client name required"),
        emailIssue(draft.primaryEmail),
        phoneIssue(draft.primaryPhone, "SMS"),
        phoneIssue(draft.whatsappPhone, "WhatsApp"),
        messagingPhoneIssue(draft.primaryPhone, draft.whatsappPhone),
        draft.selectedCodes.length ? null : "Select at least one service",

    ].filter((issue): issue is string => Boolean(issue))
    const teamIssues = [
        managers.some((m) => m.id === draft.fulfilmentManagerUserId) ? null : "Choose a fulfilment manager",
        ...selectedServices.flatMap((service) => service.serviceId && (eligibleUsers[service.serviceId] ?? []).includes(draft.serviceAssignees[service.code]) ? [] : [`Choose an eligible person for ${service.name}`]),
    ].filter((issue): issue is string => Boolean(issue))
    const onboardingIssues = [
        schemaReady ? null : "The Builder schema is not available",
        primaryMessagingProvider === "twilio_sms"
            ? twilioVerified ? null : "The workspace Twilio connection is not verified"
            : whatsappVerified ? null : "The workspace WhatsApp connection is not verified",
        assignedModules.length ? null : "The selected services do not produce a published onboarding",
    ].filter((issue): issue is string => Boolean(issue))
    const pricingIssues = [
        /^[A-Z]{3}$/.test(draft.currency.toUpperCase()) ? null : "Use a three-letter currency code",
        selectedServices.some((service) => service.serviceType === "retainer" && (draft.recurringPrices[service.code] ?? 0) > 0) && (draft.billingIntervalCount < 1 || draft.billingIntervalCount > intervalCountMaximum(draft.billingInterval)) ? `Use a recurring interval between 1 and ${intervalCountMaximum(draft.billingInterval)}` : null,
        ...selectedServices.flatMap((service) => (draft.upfrontPrices[service.code] ?? 0) > 0 || (draft.recurringPrices[service.code] ?? 0) > 0 ? [] : [`Add an upfront or recurring price for ${service.name}`]),
    ].filter((issue): issue is string => Boolean(issue))
    const upfrontTotalCents = selectedServices.reduce((total, service) => total + (draft.upfrontPrices[service.code] ?? 0), 0)
    const recurringTotalCents = selectedServices.reduce((total, service) => total + (service.serviceType === "retainer" ? draft.recurringPrices[service.code] ?? 0 : 0), 0)
    const dueTodayCents = upfrontTotalCents + recurringTotalCents
    const communicationChoices = [
        { value: "meta_whatsapp" as const, label: "WhatsApp", description: "Use the saved WhatsApp number", disabled: !whatsappPhoneAvailable },
        { value: "twilio_sms" as const, label: "Twilio SMS", description: "Use the saved mobile number", disabled: !smsPhoneAvailable },
    ]
    const deliveryChoices = [
        { value: "mirror", label: "Every connected channel", description: "Send through every available provider" },
        { value: "primary_with_fallback", label: "Primary with fallback", description: "Use another provider only if needed" },
        { value: "primary_only", label: "Primary only", description: "Never send through a fallback provider" },
    ]
    const scheduleBackgroundSave = () => window.setTimeout(() => { void saveBackground() }, 0)

    useEffect(() => {
        if (!notice) return
        const timeout = window.setTimeout(() => setNotice(null), 8400)
        return () => window.clearTimeout(timeout)
    }, [notice])

    const saveBackground = useCallback(() => queue.flush(), [queue])

    useEffect(() => { queue.setTransport(backgroundCommandsEnabled ? "command" : "action") }, [backgroundCommandsEnabled, queue])
    useEffect(() => {
        const key = `betelgeze:relationship-draft:${runtimeKey}`
        // Storage construction can itself fail in private/denied-storage modes.
        // Let the queue retain edits and block unsafe navigation in that case.
        try { queue.attachStorage(createRelationshipDraftStorage(localStorage, sessionStorage, key)) }
        catch { queue.attachStorage({ read: () => { throw new Error("Device storage unavailable") }, write: () => { throw new Error("Device storage unavailable") } }) }
        const release = retainRelationshipDraftQueue(runtimeKey, queue)
        const unregister = registerWorkspaceAutosaveFlusher(() => queue.flush(), { checkpoint: queue.checkpoint })
        const beforeUnload = (event: BeforeUnloadEvent) => {
            if (!queue.checkpoint()) { event.preventDefault(); event.returnValue = "" }
        }
        window.addEventListener("beforeunload", beforeUnload)
        return () => { unregister(); window.removeEventListener("beforeunload", beforeUnload); void queue.flush(); release() }
    }, [queue, runtimeKey])
    useEffect(() => { queue.receive(buildInitialDraft(details, services), updatedAt) }, [details, queue, services, updatedAt])

    function update<K extends keyof Draft>(key: K, value: Draft[K]) {
        if (["primaryPersonName", "businessName", "primaryContactRole", "primaryPhone", "whatsappPhone", "communicationPrimaryProvider", "communicationDeliveryMode", "primaryEmail", "description"].includes(key)) {
            setError(null)
        }
        setDraft((current) => {
            const next = { ...current, [key]: value }
            if (key !== "primaryPhone" && key !== "whatsappPhone") return next
            return {
                ...next,
                communicationPrimaryProvider: resolvePrimaryMessagingProvider({
                    requestedProvider: next.communicationPrimaryProvider,
                    smsPhone: next.primaryPhone,
                    whatsappPhone: next.whatsappPhone,
                }),
            }
        })
    }

    function toggleService(code: string) {
        setDraft((current) => {
            const removing = current.selectedCodes.includes(code)
            const service = services.find((candidate) => candidate.code === code)
            const hasSelectedRetainer = services.some((candidate) => current.selectedCodes.includes(candidate.code) && candidate.serviceType === "retainer")
            return {
                ...current,
                selectedCodes: removing ? current.selectedCodes.filter((item) => item !== code) : [...current.selectedCodes, code],
                ...(!removing && service?.serviceType === "retainer" && !hasSelectedRetainer ? {
                    billingInterval: service.defaultBillingInterval,
                    billingIntervalCount: service.defaultBillingIntervalCount,
                } : {}),
            }
        })
    }

    function dealInput(source: Draft = draft): RelationshipDealDetailsInput {
        const sourceServices = services.filter((service) => source.selectedCodes.includes(service.code))
        const effectivePrimaryProvider = resolvePrimaryMessagingProvider({
            requestedProvider: source.communicationPrimaryProvider,
            smsPhone: source.primaryPhone,
            whatsappPhone: source.whatsappPhone,
        })
        return {
            primaryPersonName: source.primaryPersonName,
            businessName: source.businessName,
            primaryContactRole: source.primaryContactRole,
            primaryPhone: source.primaryPhone,
            whatsappPhone: source.whatsappPhone,
            communicationPrimaryProvider: effectivePrimaryProvider,
            communicationDeliveryMode: source.communicationDeliveryMode,
            primaryEmail: source.primaryEmail,
            sellerUserId: source.sellerUserId,
            fulfilmentManagerUserId: source.fulfilmentManagerUserId,
            fulfilmentTeamId: source.fulfilmentTeamId,
            projectTimeframeDays: source.projectTimeframeDays,
            description: source.description,
            services: sourceServices.map((service) => ({
                code: service.code,
                serviceId: service.serviceId,
                revisionId: service.revisionId,
                upfrontPriceCents: Math.max(0, Math.round(source.upfrontPrices[service.code] ?? 0)),
                recurringPriceCents: service.serviceType === "retainer" ? Math.max(0, Math.round(source.recurringPrices[service.code] ?? 0)) : 0,
                currency: source.currency.toUpperCase(),
                assigneeUserId: source.serviceAssignees[service.code] || null,
            })),
        }
    }

    async function saveDetails() {
        if (!await saveBackground()) return false
        const release = queue.hold()
        if (!release) { setError("Wait for the current relationship save to finish."); return false }
        try {
        const source = queue.getSnapshot().draft
        const outcome = await runWorkspaceMutation(() => saveRelationshipDealDetails(workspaceSlug, relationshipId, dealInput(source)), { category: "services" })
        if (!outcome.ok) {
            setError(outcome.error)
            return false
        }
        queue.acknowledgeCommercial(source, outcome.version)
        setError(null)
        router.refresh()
        postGanttSync(workspaceSlug)
        return true
        } finally { release() }
    }

    function openInvoiceReview() {
        if (!canSell || pending) return
        setError(null)
        startTransition(async () => {
            if (!await saveBackground()) return
            const release = queue.hold()
            if (!release) { setError("Wait for the current relationship save to finish."); return }
            try {
            const result = await beginRelationshipPos(workspaceSlug, relationshipId)
            if (!result.ok) { setError(result.error); return }
            queue.advanceVersion(result.version)
            setDraft((current) => ({ ...current, sellerUserId: result.sellerUserId,
                fulfilmentManagerUserId: current.fulfilmentManagerUserId || (managers.length === 1 ? managers[0].id : ""),
                serviceAssignees: Object.fromEntries(services.map((service) => {
                    const candidates = service.serviceId ? eligibleUsers[service.serviceId] ?? [] : []
                    return [service.code, current.serviceAssignees[service.code] || (candidates.length === 1 ? candidates[0] : "")]
                })),
            }))
            setInvoiceStep(0); setInvoiceOpen(true)
            } finally { release() }
        })
    }

    function nextFromRelationship() {
        if (relationshipIssues.length) {
            setError("Complete the highlighted relationship information before reviewing onboarding.")
            return
        }
        startTransition(() => { void saveDetails().then((saved) => { if (saved) setInvoiceStep(1) }) })
    }

    function invoiceClient() {
        if (!currentWork || currentWork.action !== "sell_client") {
            setError("This relationship is no longer waiting to be sold. Reload and review its current stage.")
            return
        }
        if (teamIssues.length || pricingIssues.length) {
            setError(teamIssues[0] ?? pricingIssues[0])
            return
        }
        startTransition(() => {
            void (async () => {
                if (!await saveDetails()) return
                const outcome = await runWorkspaceMutation(() => proceedRelationshipCurrentWork(workspaceSlug, relationshipId, currentWork.id, {
                    billingInterval: draft.billingInterval,
                    billingIntervalCount: draft.billingIntervalCount,
                }), { category: "billing" })
                if (!outcome.ok) {
                    setError(outcome.error)
                    return
                }
                setInvoiceOpen(false)
                if (outcome.sale?.kind === "sms") {
                    setNotice({ label: outcome.sale.sent ? "Client sold and SMS confirmation sent" : "Client sold and waiting for SMS opt-in" })
                } else {
                    setNotice({ label: "Confirmation sent via WhatsApp" })
                }
                router.refresh()
                postGanttSync(workspaceSlug)
            })().catch(() => setError("The client confirmation could not be sent. Please try again."))
        })
    }

    const detailsPanel = <div data-relationship-details>
        <DetailFields>
            <DetailField label="Name" icon="identity"><input disabled={!canEdit} value={draft.primaryPersonName} onChange={(event) => update("primaryPersonName", event.target.value)} onBlur={() => void saveBackground()} placeholder="Client name" className={inputClass} /></DetailField>
            <DetailField label="Company" icon="identity" className="lg:border-l lg:border-neutral-900 lg:pl-8"><input disabled={!canEdit} value={draft.businessName} onChange={(event) => update("businessName", event.target.value)} onBlur={() => void saveBackground()} placeholder="No company" className={inputClass} /></DetailField>
            <DetailField label="Role" icon="identity"><input disabled={!canEdit} value={draft.primaryContactRole} onChange={(event) => update("primaryContactRole", event.target.value)} onBlur={() => void saveBackground()} placeholder="Not set" className={inputClass} /></DetailField>
            <DetailField label="SMS number" icon="contact" className="lg:border-l lg:border-neutral-900 lg:pl-8"><input disabled={!canEdit} type="tel" value={draft.primaryPhone} onChange={(event) => update("primaryPhone", event.target.value)} onBlur={() => void saveBackground()} placeholder="Not set" className={inputClass} /></DetailField>
            <DetailField label="WhatsApp" icon="contact"><input disabled={!canEdit} type="tel" value={draft.whatsappPhone} onChange={(event) => update("whatsappPhone", event.target.value)} onBlur={() => void saveBackground()} placeholder="Optional alternate channel" className={inputClass} /></DetailField>
            <DetailField label="Email" icon="contact" className="lg:border-l lg:border-neutral-900 lg:pl-8"><input disabled={!canEdit} type="email" value={draft.primaryEmail} onChange={(event) => update("primaryEmail", event.target.value)} onBlur={() => void saveBackground()} placeholder="Required before selling" className={inputClass} /></DetailField>
            <DetailField label="Primary messaging" icon="contact"><CommunicationMethodSelector value={draft.communicationPrimaryProvider} choices={communicationChoices} onChange={(value) => update("communicationPrimaryProvider", value as Draft["communicationPrimaryProvider"])} onCommit={scheduleBackgroundSave} disabled={!canEdit} ariaLabel="Primary messaging provider" /></DetailField>
            <DetailField label="Outbound delivery" icon="contact" className="lg:border-l lg:border-neutral-900 lg:pl-8"><Selector value={draft.communicationDeliveryMode} options={deliveryChoices} onChange={(value) => update("communicationDeliveryMode", value as Draft["communicationDeliveryMode"])} onCommit={scheduleBackgroundSave} disabled={!canEdit} ariaLabel="Outbound delivery mode" title="Outbound delivery" /></DetailField>
            <DetailField label="Seller" icon="person">{members.find((m) => m.id === draft.sellerUserId) ? <Assignee userId={draft.sellerUserId} name={members.find((m) => m.id === draft.sellerUserId)!.name} avatarSrc={members.find((m) => m.id === draft.sellerUserId)!.avatarSrc} /> : <span className="text-neutral-600">Assigned when POS begins</span>}</DetailField>
            <DetailField label="Manager" icon="person" className="lg:border-l lg:border-neutral-900 lg:pl-8">{canSell && !commercialLocked ? <AssignmentSelector value={draft.fulfilmentManagerUserId} people={managers} onChange={(value) => update("fulfilmentManagerUserId", value)} ariaLabel="Client project manager" placeholder="Choose during POS" clearLabel="No manager" title="Assign project manager" /> : members.find((m) => m.id === draft.fulfilmentManagerUserId) ? <Assignee userId={draft.fulfilmentManagerUserId} name={members.find((m) => m.id === draft.fulfilmentManagerUserId)!.name} avatarSrc={members.find((m) => m.id === draft.fulfilmentManagerUserId)!.avatarSrc} /> : <span className="text-neutral-600">Choose during POS</span>}</DetailField>
            {invoiced ? <DetailField label="Client team" icon="person" className="lg:col-span-2"><div className="flex flex-wrap gap-2">{selectedServices.map((service) => { const person = members.find((member) => member.id === draft.serviceAssignees[service.code]); return <span key={service.code} className="flex items-center gap-2 text-xs text-neutral-500"><span>{service.name}</span><Assignee userId={person?.id} name={person?.name ?? "Unassigned"} avatarSrc={person?.avatarSrc} /></span> })}</div></DetailField> : null}
            <DetailField label={invoiced ? "Project timeline" : "Planned project timeline"} icon="timeline" className="lg:col-span-2"><div className="flex items-center gap-2"><input disabled={!canSell || commercialLocked} type="number" min="1" value={draft.projectTimeframeDays ?? ""} onChange={(event) => update("projectTimeframeDays", event.target.value ? Number(event.target.value) : null)} placeholder="Not set" className={`${inputClass} max-w-24`} />{draft.projectTimeframeDays ? <span className="text-neutral-500">days</span> : null}</div></DetailField>
        <DetailField label="Services" icon="services" className="lg:col-span-2">
            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                {selectedServices.map((service) => <RoundPill key={service.code} tone="emerald">{service.name}</RoundPill>)}
                {!selectedServices.length ? <span className="text-neutral-600">None</span> : null}
                {canSell && !commercialLocked ? <button type="button" onClick={() => setServicesOpen((open) => !open)} className="ml-auto text-xs text-neutral-400 underline underline-offset-4 hover:text-white">{servicesOpen ? "Done" : "Edit services"}</button> : null}
            </div>
            {servicesOpen && !commercialLocked ? <div className="mt-2 grid gap-1.5 rounded-lg border border-neutral-800 bg-neutral-950 p-2 sm:grid-cols-2 lg:grid-cols-3">{services.map((service) => <label key={service.code} className="flex items-start gap-2 rounded-md px-2 py-2 text-sm hover:bg-neutral-900"><input type="checkbox" checked={draft.selectedCodes.includes(service.code)} onChange={() => toggleService(service.code)} className="mt-0.5" /><span className="min-w-0"><span className="flex items-center gap-1.5"><span className="truncate text-neutral-200">{service.name}</span>{service.isTest ? <SquarePill tone="yellow">Test</SquarePill> : null}</span><span className="mt-0.5 block truncate text-[11px] text-neutral-600">{service.revisionNumber ? `Revision ${service.revisionNumber}` : service.code}</span></span></label>)}</div> : null}
        </DetailField>
        <DetailField label="Description" icon="description" className="lg:col-span-2"><textarea disabled={!canEdit} value={draft.description} onChange={(event) => update("description", event.target.value)} onBlur={() => void saveBackground()} rows={3} placeholder="Add relationship context…" className={`${inputClass} min-h-20 resize-none leading-6`} /></DetailField>
        </DetailFields>
        {error && !invoiceOpen ? <p className="border-t border-red-500/20 py-2 text-sm text-red-300">{error}</p> : null}
        {snapshot.conflict ? <div role="alert" className="flex flex-wrap items-center gap-3 border-t border-neutral-900 py-3 text-xs text-amber-200">
            <span>Your draft is preserved. Review the latest relationship before saving.</span>
            <button type="button" onClick={() => router.refresh()} className="underline underline-offset-4">Refresh latest values</button>
            {snapshot.latest ? <>
                <button type="button" onClick={() => queue.resolveConflict(false)} className="underline underline-offset-4">Use latest saved values</button>
                <button type="button" onClick={() => queue.resolveConflict(true)} className="underline underline-offset-4">Keep my edits and retry</button>
            </> : null}
        </div> : null}
        {canEdit ? <div className="flex items-center justify-between gap-3 border-t border-neutral-900 py-2.5"><span aria-live="polite" className={`text-xs ${autosaveState === "error" ? "text-red-300" : "text-neutral-500"}`}>{autosaveState === "saving" ? "Saving relationship details…" : autosaveState === "error" ? "Relationship details could not save automatically" : backgroundDirty ? "Relationship details will save automatically" : autosaveState === "saved" ? "Relationship details saved" : "Relationship details save automatically"}</span>{autosaveState === "error" ? <button type="button" onClick={() => void saveBackground()} className="text-xs text-red-200 underline decoration-red-500/50 underline-offset-2 hover:text-white">Retry</button> : commercialDirty && canSell && !commercialLocked ? <div className="flex justify-end gap-2"><button type="button" disabled={pending} onClick={() => { setDraft((current) => ({ ...baseline, primaryPersonName: current.primaryPersonName, businessName: current.businessName, primaryContactRole: current.primaryContactRole, primaryPhone: current.primaryPhone, whatsappPhone: current.whatsappPhone, communicationPrimaryProvider: current.communicationPrimaryProvider, communicationDeliveryMode: current.communicationDeliveryMode, primaryEmail: current.primaryEmail, description: current.description })); setServicesOpen(false); setError(null) }} className="h-8 px-2 text-xs text-neutral-400 hover:text-white disabled:opacity-50">Cancel</button><button type="button" disabled={pending} onClick={() => startTransition(() => { void saveDetails() })} className="h-8 rounded-md bg-white px-3 text-xs font-medium text-black disabled:opacity-50">{pending ? "Saving…" : "Save commercial changes"}</button></div> : null}</div> : null}
    </div>

    const modal = invoiceOpen && workspaceTabActive && parentDocument ? createPortal(<div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/75 p-3 text-white backdrop-blur-sm">
        <section role="dialog" aria-modal="true" aria-labelledby="invoice-review-title" className="betelgeze-popup-enter flex max-h-[min(92dvh,56rem)] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-neutral-700 bg-neutral-950 shadow-2xl shadow-black/70">
            <header className="shrink-0 border-b border-neutral-800 px-4 py-4 sm:px-6">
                <div className="flex items-start justify-between gap-4"><div><p className="text-xs font-medium uppercase tracking-[0.16em] text-neutral-500">Sell client</p><h2 id="invoice-review-title" className="mt-1 text-xl font-semibold">{invoiceStep === 0 ? "Review Relationship Information" : invoiceStep === 1 ? "Assemble Client Team" : invoiceStep === 2 ? "Review Onboarding" : "Pricing"}</h2><p className="mt-1 text-sm text-neutral-500">{invoiceStep === 0 ? "Double-check the client's details and the services they are buying." : invoiceStep === 1 ? "Choose the manager and the person delivering each service." : invoiceStep === 2 ? "Confirm the published onboarding this client will receive." : "Review each service's upfront and ongoing charges."}</p></div><button type="button" aria-label="Close sale review" onClick={() => { setInvoiceOpen(false); setError(null) }} className="text-neutral-500 hover:text-white">✕</button></div>
                <div className="mt-4 grid grid-cols-4 gap-2" aria-label={`Step ${invoiceStep + 1} of 4`}>{["Relationship", "Team", "Onboarding", "Pricing"].map((label, index) => <div key={label}><div className={`h-1 rounded-full ${index <= invoiceStep ? "bg-white" : "bg-neutral-800"}`} /><p className={`mt-1.5 text-[11px] ${index === invoiceStep ? "text-white" : "text-neutral-600"}`}>{index + 1}. {label}</p></div>)}</div>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6 sm:py-5">
                {invoiceStep === 0 ? <div className="grid gap-3 sm:grid-cols-2">
                    <label className="text-xs text-neutral-500">Name<input value={draft.primaryPersonName} onChange={(event) => update("primaryPersonName", event.target.value)} className="mt-1.5 h-10 w-full rounded-lg border border-neutral-700 bg-black px-3 text-sm text-white" /><MissingHint message={missingText(draft.primaryPersonName, "Required")} /></label>
                    <label className="text-xs text-neutral-500">Company<input value={draft.businessName} onChange={(event) => update("businessName", event.target.value)} placeholder="Optional" className="mt-1.5 h-10 w-full rounded-lg border border-neutral-700 bg-black px-3 text-sm text-white" /></label>
                    <label className="text-xs text-neutral-500">Role<input value={draft.primaryContactRole} onChange={(event) => update("primaryContactRole", event.target.value)} placeholder="Optional" className="mt-1.5 h-10 w-full rounded-lg border border-neutral-700 bg-black px-3 text-sm text-white" /></label>
                    <label className="text-xs text-neutral-500">SMS number<input type="tel" value={draft.primaryPhone} onChange={(event) => update("primaryPhone", event.target.value)} placeholder="Optional" className="mt-1.5 h-10 w-full rounded-lg border border-neutral-700 bg-black px-3 text-sm text-white" /><MissingHint message={phoneIssue(draft.primaryPhone, "SMS")} /></label>
                    <label className="text-xs text-neutral-500">WhatsApp number<input type="tel" value={draft.whatsappPhone} onChange={(event) => update("whatsappPhone", event.target.value)} placeholder="Optional alternate channel" className="mt-1.5 h-10 w-full rounded-lg border border-neutral-700 bg-black px-3 text-sm text-white" /><MissingHint message={phoneIssue(draft.whatsappPhone, "WhatsApp")} /></label>
                    <label className="text-xs text-neutral-500">Primary messaging<span className="mt-1.5 block"><CommunicationMethodSelector value={draft.communicationPrimaryProvider} choices={communicationChoices} onChange={(value) => update("communicationPrimaryProvider", value as Draft["communicationPrimaryProvider"])} appearance="input" ariaLabel="Primary messaging provider" /></span><MissingHint message={messagingPhoneIssue(draft.primaryPhone, draft.whatsappPhone)} /></label>
                    <label className="text-xs text-neutral-500">Outbound delivery<span className="mt-1.5 block"><Selector value={draft.communicationDeliveryMode} options={deliveryChoices} onChange={(value) => update("communicationDeliveryMode", value as Draft["communicationDeliveryMode"])} appearance="input" ariaLabel="Outbound delivery mode" title="Outbound delivery" /></span></label>
                    <label className="text-xs text-neutral-500">Billing email<input type="email" value={draft.primaryEmail} onChange={(event) => update("primaryEmail", event.target.value)} className="mt-1.5 h-10 w-full rounded-lg border border-neutral-700 bg-black px-3 text-sm text-white" /><MissingHint message={emailIssue(draft.primaryEmail)} /></label>
                    <div className="flex items-center gap-2 text-xs text-neutral-500 sm:col-span-2"><span>Seller</span>{members.find((m) => m.id === draft.sellerUserId) ? <Assignee userId={draft.sellerUserId} name={members.find((m) => m.id === draft.sellerUserId)!.name} avatarSrc={members.find((m) => m.id === draft.sellerUserId)!.avatarSrc} /> : <span>You</span>}</div>
                    <label className="text-xs text-neutral-500">Planned project timeline<div className="mt-1.5 flex h-10 items-center rounded-lg border border-neutral-700 bg-black px-3"><input type="number" min="1" value={draft.projectTimeframeDays ?? ""} onChange={(event) => update("projectTimeframeDays", event.target.value ? Number(event.target.value) : null)} placeholder="Optional" className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none" />{draft.projectTimeframeDays ? <span className="text-xs text-neutral-500">days</span> : null}</div></label>
                    <div className="sm:col-span-2"><p className="text-xs text-neutral-500">Services</p><div className="mt-1.5 grid gap-1.5 rounded-lg border border-neutral-800 bg-black p-2 sm:grid-cols-2">{services.map((service) => <label key={service.code} className="flex items-start gap-2 rounded-md px-2 py-2 hover:bg-neutral-900"><input type="checkbox" checked={draft.selectedCodes.includes(service.code)} onChange={() => toggleService(service.code)} className="mt-0.5" /><span className="min-w-0"><span className="flex items-center gap-1.5 text-sm text-neutral-200">{service.name}{service.isTest ? <SquarePill tone="yellow">Test</SquarePill> : null}</span><span className="mt-0.5 block text-[11px] text-neutral-600">{service.description || `Service ${service.code}`}</span></span></label>)}</div><MissingHint message={draft.selectedCodes.length ? null : "Select at least one service"} /></div>
                    <label className="text-xs text-neutral-500 sm:col-span-2">Description<textarea value={draft.description} onChange={(event) => update("description", event.target.value)} rows={3} placeholder="Optional relationship context" className="mt-1.5 min-h-20 w-full resize-none rounded-lg border border-neutral-700 bg-black px-3 py-2 text-sm leading-6 text-white" /></label>
                </div> : null}
                {invoiceStep === 1 ? <div className="space-y-4">
                    <DetailFields className="!mt-0 !grid-cols-1">
                        <DetailField label="Manager" icon="person"><AssignmentSelector value={draft.fulfilmentManagerUserId} people={managers} onChange={(value) => update("fulfilmentManagerUserId", value)} ariaLabel="Client project manager" placeholder="Choose manager" clearLabel="Choose manager" required disabled={commercialLocked} appearance="input" title="Assign project manager" />{!managers.length ? <MissingHint message="Add a manager in Settings → Teams." /> : null}</DetailField>
                        {selectedServices.map((service) => {
                            const candidates = members.filter((m) => service.serviceId && (eligibleUsers[service.serviceId] ?? []).includes(m.id))
                            return <DetailField key={service.code} label={service.name} icon="services"><AssignmentSelector value={draft.serviceAssignees[service.code] ?? ""} people={candidates} onChange={(value) => update("serviceAssignees", { ...draft.serviceAssignees, [service.code]: value })} ariaLabel={`Delivery person for ${service.name}`} placeholder="Choose fulfilment person" clearLabel="Choose fulfilment person" required disabled={commercialLocked} appearance="input" title="Assign delivery person" />{!candidates.length ? <MissingHint message="Choose eligible people in Settings → Services." /> : null}</DetailField>
                        })}
                    </DetailFields>
                    <p className="text-xs leading-5 text-neutral-500">The seller, manager, and fulfilment people will share an internal team chat. The client conversation starts with the seller and manager.</p>
                </div> : null}

                {invoiceStep === 2 ? <div className="space-y-3">
                    {onboardingIssues.length ? <div className="rounded-lg border border-amber-500/25 bg-amber-950/15 px-3 py-2.5 text-xs leading-5 text-amber-200">{onboardingIssues.map((issue) => <p key={issue}>{issue}</p>)}</div> : null}
                    <div className="flex items-center justify-between gap-3">
                        <div><p className="text-sm font-medium text-neutral-200">Client onboarding</p><p className="mt-0.5 text-xs text-neutral-600">{assignedModules.length} module{assignedModules.length === 1 ? "" : "s"} · {assignedModules.reduce((count, module) => count + module.steps.length, 0)} onboarding steps</p></div>
                        <button type="button" disabled={!assignedModules.length} onClick={() => setOnboardingPreviewOpen(true)} className="h-9 shrink-0 rounded-lg border border-neutral-700 px-3 text-xs font-medium text-neutral-100 hover:border-neutral-500 disabled:cursor-not-allowed disabled:opacity-40">Preview onboarding</button>
                    </div>
                    <div className="divide-y divide-neutral-900 overflow-hidden rounded-xl border border-neutral-800 bg-black">{assignedModules.map((module, index) => <div key={module.id} className="flex items-center gap-3 px-3 py-3"><span className="w-5 shrink-0 text-center text-xs tabular-nums text-neutral-600">{index + 1}</span><div className="min-w-0 flex-1"><RoundPill tone="sky">{module.name}</RoundPill><p className="mt-1.5 text-xs text-neutral-600">{module.steps.length} step{module.steps.length === 1 ? "" : "s"}{module.mandatory ? " · mandatory" : " · selected service"}</p></div></div>)}</div>
                </div> : null}
                {invoiceStep === 3 ? <div className="space-y-4">
                    <div className="flex flex-col justify-between gap-3 rounded-xl border border-neutral-800 bg-black p-3 sm:flex-row sm:items-end">
                        <label className="text-xs text-neutral-500">Currency<input value={draft.currency} onChange={(event) => update("currency", event.target.value.toUpperCase().slice(0, 3))} maxLength={3} className="mt-1.5 h-9 w-24 rounded-lg border border-neutral-700 bg-neutral-950 px-3 text-sm uppercase text-white" /></label>
                        {recurringTotalCents > 0 ? <div className="flex gap-2">
                            <label className="text-xs text-neutral-500">Repeat every<input type="number" min="1" max={intervalCountMaximum(draft.billingInterval)} value={draft.billingIntervalCount} onChange={(event) => update("billingIntervalCount", Math.max(1, Math.min(intervalCountMaximum(draft.billingInterval), Math.round(Number(event.target.value) || 1))))} className="mt-1.5 h-9 w-20 rounded-lg border border-neutral-700 bg-neutral-950 px-2 text-sm text-white" /></label>
                            <label className="text-xs text-neutral-500">Period<select value={draft.billingInterval} onChange={(event) => { const interval = event.target.value as Draft["billingInterval"]; setDraft((current) => ({ ...current, billingInterval: interval, billingIntervalCount: Math.min(current.billingIntervalCount, intervalCountMaximum(interval)) })) }} className="mt-1.5 h-9 rounded-lg border border-neutral-700 bg-neutral-950 px-3 text-sm text-white"><option value="week">Week(s)</option><option value="month">Month(s)</option><option value="year">Year(s)</option></select></label>
                        </div> : <p className="max-w-md text-xs leading-5 text-neutral-600">No recurring charges are currently included. Checkout will collect the upfront total once.</p>}
                    </div>
                    <div className="divide-y divide-neutral-900 overflow-hidden rounded-xl border border-neutral-800 bg-black">{selectedServices.map((service) => <div key={service.code} className={`grid gap-3 px-3 py-3 sm:items-center ${service.serviceType === "retainer" ? "sm:grid-cols-[3rem_minmax(0,1fr)_8rem_8rem]" : "sm:grid-cols-[3rem_minmax(0,1fr)_8rem]"}`}>
                        <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-lg border border-neutral-800 bg-neutral-900 text-[9px] uppercase tracking-wide text-neutral-600">{service.thumbnailUrl ? <Image src={service.thumbnailUrl} alt="" width={48} height={48} unoptimized className="h-full w-full object-cover" /> : "Service"}</div>
                        <div className="min-w-0"><p className="truncate text-sm font-medium text-neutral-100">{service.name}</p><p className="mt-1 line-clamp-2 text-xs leading-5 text-neutral-600">{service.description || "Client-facing service"}</p>{service.serviceType === "retainer" ? <p className="mt-1 truncate text-xs text-neutral-400">Recurring: {service.recurringName}</p> : null}</div>
                        <label className="text-xs text-neutral-500">{service.serviceType === "retainer" ? "Upfront" : "One-time"}<input type="number" min="0" step="0.01" value={(draft.upfrontPrices[service.code] ?? 0) / 100} onChange={(event) => setDraft((current) => ({ ...current, upfrontPrices: { ...current.upfrontPrices, [service.code]: Math.round(Number(event.target.value || 0) * 100) } }))} className="mt-1 h-9 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-2 text-sm text-white" /></label>
                        {service.serviceType === "retainer" ? <label className="text-xs text-neutral-500">Recurring<input type="number" min="0" step="0.01" value={(draft.recurringPrices[service.code] ?? 0) / 100} onChange={(event) => setDraft((current) => ({ ...current, recurringPrices: { ...current.recurringPrices, [service.code]: Math.round(Number(event.target.value || 0) * 100) } }))} className="mt-1 h-9 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-2 text-sm text-white" /></label> : null}
                    </div>)}</div>
                    <div className="grid gap-3 border-t border-neutral-800 pt-4 sm:grid-cols-3"><div><p className="text-xs text-neutral-500">Upfront fees</p><p className="mt-1 text-lg font-semibold">{priceLabel(upfrontTotalCents, draft.currency)}</p></div><div><p className="text-xs text-neutral-500">Recurring total</p><p className="mt-1 text-lg font-semibold">{priceLabel(recurringTotalCents, draft.currency)}</p></div><div className="sm:text-right"><p className="text-xs text-neutral-500">Due at Checkout</p><p className="mt-1 text-2xl font-semibold">{priceLabel(dueTodayCents, draft.currency)}</p></div></div>
                    <p className="text-right text-xs leading-5 text-neutral-600">Due at Checkout includes the upfront fees and the first recurring period. Sending the client confirmation freezes these services, prices and onboarding.</p>
                </div> : null}
                {error ? <p role="alert" className="mt-4 rounded-lg border border-red-500/20 bg-red-950/20 px-3 py-2.5 text-sm text-red-300">{error}</p> : null}
            </div>
            <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-neutral-800 px-4 py-3 sm:px-6"><button type="button" disabled={invoiceStep === 0 || pending} onClick={() => { setInvoiceStep((step) => Math.max(0, step - 1)); setError(null) }} className="h-9 px-2 text-sm text-neutral-400 hover:text-white disabled:opacity-0">Back</button>{invoiceStep === 0 ? <button type="button" disabled={pending} onClick={nextFromRelationship} className="h-10 rounded-lg bg-white px-4 text-sm font-semibold text-black disabled:opacity-50">{pending ? "Saving…" : "Assemble team"}</button> : invoiceStep === 1 ? <button type="button" disabled={pending || teamIssues.length > 0} onClick={() => { startTransition(async () => { if (await saveDetails()) setInvoiceStep(2) }) }} className="h-10 rounded-lg bg-white px-4 text-sm font-semibold text-black disabled:opacity-40">Review onboarding</button> : invoiceStep === 2 ? <button type="button" disabled={pending || onboardingIssues.length > 0} onClick={() => { setInvoiceStep(3); setError(null) }} className="h-10 rounded-lg bg-white px-4 text-sm font-semibold text-black disabled:opacity-40">Review pricing</button> : <button type="button" disabled={pending || pricingIssues.length > 0} onClick={invoiceClient} className="h-10 rounded-lg bg-white px-4 text-sm font-semibold text-black disabled:opacity-40">{pending ? "Selling…" : saleUsesSms ? "Sell and send SMS" : sendConfirmationLabel}</button>}</footer>
        </section>
    </div>, parentDocument.body) : null

    const preview = <OnboardingPreviewOverlay open={onboardingPreviewOpen && workspaceTabActive} onClose={() => setOnboardingPreviewOpen(false)}>
        <BuilderPreview fullWindow modules={assignedModules} payment={payment} theme={theme} help={help} workspaceName={workspaceName} logoSrc={logoSrc} client={{ name: draft.primaryPersonName || "Preview client", email: draft.primaryEmail || null, phone: draft.primaryPhone || draft.whatsappPhone || null, isTest: false }} privacyPolicyUrl={privacyPolicyUrl} termsOfServiceUrl={termsOfServiceUrl} />
    </OnboardingPreviewOverlay>

    return <>
        {detailsPanel}
        <Suspense fallback={<DetailContentLoading label="Loading relationship timeline" className="mt-5 min-h-72" />}>
            <div className="mt-5"><RelationshipGanttContent workspaceSlug={workspaceSlug} relationshipId={relationshipId} planPromise={planPromise} canEdit={canEdit} currentWork={currentWork} userId={userId} onInvoiceRequest={openInvoiceReview} /></div>
        </Suspense>
        {modal}
        {preview}
        {notice && workspaceTabActive ? <WorkspaceSuccessNotice label={notice.label} /> : null}
    </>
}
