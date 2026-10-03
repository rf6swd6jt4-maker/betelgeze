"use client"

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore, type ComponentProps, type ReactNode } from "react"
import WorkspaceLink from "@/components/workspace/WorkspaceLink"
import { MessageReferenceResolver } from "@/lib/communications/reference-resolver"
import { MessageReferenceObservation } from "@/lib/communications/reference-observation"
import { chatRecordReferences, recordReferenceKey, type RecordReference, type RecordReferenceResult, type ReferenceContext } from "@/lib/communications/references"
import { ReferenceIcon } from "./ReferenceIcon"
import { MessageComposer } from "./MessageComposer"

type Scope = { resolver: MessageReferenceResolver; observe: (element: HTMLElement, reference: RecordReference) => () => void; resolveDraft: (references: readonly RecordReference[]) => void; clearDraft: () => void; active: boolean; personDestinations?: ReadonlyMap<string, string> }
const References = createContext<Scope | null>(null)
const EMPTY_REFERENCE_LABELS: ReadonlyMap<string, RecordReferenceResult> = new Map()

export function MessageReferences({ context, active, personDestinations, children }: { context: ReferenceContext; active: boolean; personDestinations?: ReadonlyMap<string, string>; children: ReactNode }) {
    const { workspaceSlug, workspaceId, userId, conversationId } = context
    const resolver = useMemo(() => new MessageReferenceResolver({ workspaceSlug, workspaceId, userId, conversationId }), [workspaceSlug, workspaceId, userId, conversationId])
    const observation = useMemo(() => new MessageReferenceObservation(resolver), [resolver])
    useLayoutEffect(() => {
        observation.setActive(active)
        return () => observation.setActive(false)
    }, [observation, active])
    const scope = useMemo(() => ({ resolver, observe: observation.observe, resolveDraft: observation.resolveDraft, clearDraft: observation.clearDraft, active, personDestinations }), [resolver, observation, active, personDestinations])
    return <References.Provider value={scope}>{children}</References.Provider>
}

export function ChatPersonReference({ userId, children, className }: { userId: string; children: ReactNode; className?: string }) {
    const scope = useContext(References)
    // Client and portal messages retain their existing plain mention treatment.
    if (!scope) return <strong>{children}</strong>
    const href = scope.active ? scope.personDestinations?.get(userId) : null
    return href ? <WorkspaceLink prefetch={false} href={href} className={`font-semibold ${className ?? ""}`} onClick={event => event.stopPropagation()}>{children}</WorkspaceLink>
        : <strong aria-disabled="true" className="text-neutral-500">{children}</strong>
}

export function ChatRecordReference({ reference, className }: { reference: RecordReference; className?: string }) {
    const scope = useContext(References)
    return scope ? <ResolvedRecordReference scope={scope} reference={reference} className={className} /> : <span aria-disabled="true" className="text-neutral-500">Unavailable reference</span>
}

function ResolvedRecordReference({ scope, reference, className }: { scope: Scope; reference: RecordReference; className?: string }) {
    const { type, id } = reference
    const { observe, active } = scope
    const key = recordReferenceKey(reference)
    const element = useRef<HTMLSpanElement | null>(null)
    const subscribe = useCallback((listener: () => void) => scope.resolver.cache.subscribe(key, listener), [scope.resolver, key])
    const getSnapshot = useCallback(() => scope.resolver.cache.getSnapshot(key), [scope.resolver, key])
    const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
    useEffect(() => {
        if (element.current && active) return observe(element.current, { type, id })
    }, [observe, active, type, id]) // Reference identity, not parser object identity.
    const result = scope.active ? snapshot.data?.reference : null
    const label = snapshot.error ? "Reference check failed" : snapshot.data ? "Unavailable reference" : "Checking reference…"
    return <span ref={element} data-chat-record-reference={key}>
        {result ? <WorkspaceLink prefetch={false} href={result.href} className={`font-semibold ${className ?? ""}`} onClick={event => event.stopPropagation()}><ReferenceIcon type={reference.type} className="mr-1 inline-block h-3.5 w-3.5 align-[-0.125em]" />{result.label}</WorkspaceLink>
            : <span aria-disabled="true" aria-busy={snapshot.loading || undefined} className="text-neutral-500" title={snapshot.error ? "Return to this chat or focus the window to retry" : undefined}>{label}</span>}
    </span>
}

function draftReferenceStore(resolver: MessageReferenceResolver | undefined, references: RecordReference[]) {
    let previous: unknown[] = []
    let labels = EMPTY_REFERENCE_LABELS
    return {
        subscribe: (listener: () => void) => {
            const stops = references.map(reference => resolver?.cache.subscribe(recordReferenceKey(reference), listener))
            return () => { for (const stop of stops) stop?.() }
        },
        getSnapshot: () => {
            const next = references.map(reference => resolver?.cache.getSnapshot(recordReferenceKey(reference)))
            if (next.length !== previous.length || next.some((snapshot, index) => snapshot !== previous[index])) {
                previous = next
                labels = new Map(next.flatMap(snapshot => snapshot?.data?.reference ? [[recordReferenceKey(snapshot.data.reference), snapshot.data.reference] as const] : []))
            }
            return labels
        },
    }
}

/** Draft labels remain ephemeral; persisted drafts retain opaque references only. */
export function NativeReferenceComposer(props: ComponentProps<typeof MessageComposer>) {
    const scope = useContext(References)
    const signature = chatRecordReferences(props.draft).map(recordReferenceKey).join(",")
    const references = useMemo(() => signature ? signature.split(",").map(key => { const [type, id] = key.split(":"); return { type, id } as RecordReference }) : [], [signature])
    const resolver = scope?.resolver
    const store = useMemo(() => draftReferenceStore(resolver, references), [resolver, references])
    const labels = useSyncExternalStore(store.subscribe, store.getSnapshot, () => EMPTY_REFERENCE_LABELS)
    useEffect(() => {
        const editor = props.textareaRef.current
        // A pasted reference or newly opened edit may arrive after focus. It
        // still resolves only while the active composer actually owns focus.
        if (scope?.active && editor === editor?.ownerDocument.activeElement) scope.resolveDraft(references)
    }, [scope, references, props.textareaRef])
    useEffect(() => () => scope?.clearDraft(), [scope])
    return <div className="contents" onFocusCapture={() => {
        const editor = props.textareaRef.current
        if (scope?.active && editor === editor?.ownerDocument.activeElement) scope.resolveDraft(references)
    }}>
        <MessageComposer {...props} referenceLabels={scope?.active ? labels : EMPTY_REFERENCE_LABELS} onReferenceSelected={reference => scope?.resolver.remember(reference)} onBlur={() => { scope?.clearDraft(); props.onBlur?.() }} />
    </div>
}
