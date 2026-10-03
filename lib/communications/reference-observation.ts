import type { MessageReferenceResolver } from "./reference-resolver"
import type { RecordReference } from "../chat-formatting"

type ObservationEnvironment = {
    createObserver: (callback: IntersectionObserverCallback) => Pick<IntersectionObserver, "observe" | "unobserve" | "disconnect">
    listenForFocus: (callback: () => void) => () => void
}
const browserObservation: ObservationEnvironment = {
    createObserver: callback => new IntersectionObserver(callback),
    listenForFocus: callback => { window.addEventListener("focus", callback); return () => window.removeEventListener("focus", callback) },
}

/** The message provider's observer lifecycle; ordinary chats allocate no DOM observers or listeners. */
export class MessageReferenceObservation {
    private elements = new Map<HTMLElement, RecordReference>()
    private visible = new Set<HTMLElement>()
    private draft: readonly RecordReference[] = []
    private observer: ReturnType<ObservationEnvironment["createObserver"]> | null = null
    private stopFocus: (() => void) | null = null
    private observerVersion = 0
    private active = false
    private readonly resolver: Pick<MessageReferenceResolver, "setActive" | "resolve" | "clear">
    private readonly environment: ObservationEnvironment
    constructor(resolver: Pick<MessageReferenceResolver, "setActive" | "resolve" | "clear">, environment: ObservationEnvironment = browserObservation) {
        this.resolver = resolver
        this.environment = environment
    }

    setActive(active: boolean) {
        this.active = active
        this.resolver.setActive(active)
        if (!active) this.draft = []
        this.reconcile()
    }
    private reconcile() {
        if (!this.active || !this.elements.size) {
            if (this.observer) { this.observer.disconnect(); this.observerVersion++ }
            this.observer = null
            this.visible.clear()
        } else if (!this.observer) {
            const version = ++this.observerVersion
            this.observer = this.environment.createObserver(entries => {
                if (!this.active || version !== this.observerVersion) return
                for (const entry of entries) {
                    const element = entry.target as HTMLElement
                    const reference = this.elements.get(element)
                    if (entry.isIntersecting && reference) { this.visible.add(element); this.resolver.resolve(reference) }
                    else this.visible.delete(element)
                }
            })
            for (const element of this.elements.keys()) this.observer.observe(element)
        }
        if (this.active && (this.elements.size || this.draft.length)) {
            this.stopFocus ??= this.environment.listenForFocus(this.refresh)
        } else {
            this.stopFocus?.()
            this.stopFocus = null
        }
    }
    private refresh = () => {
        if (!this.active) return
        this.resolver.clear()
        for (const element of this.visible) {
            const reference = this.elements.get(element)
            if (reference) this.resolver.resolve(reference)
        }
        for (const reference of this.draft) this.resolver.resolve(reference)
    }
    observe = (element: HTMLElement, reference: RecordReference) => {
        this.elements.set(element, reference)
        this.observer?.observe(element)
        this.reconcile()
        return () => {
            if (this.elements.get(element) !== reference) return
            this.observer?.unobserve(element)
            this.elements.delete(element)
            this.visible.delete(element)
            this.reconcile()
        }
    }
    resolveDraft = (references: readonly RecordReference[]) => {
        if (!this.active) return
        this.draft = references
        this.reconcile()
        for (const reference of references) this.resolver.resolve(reference)
    }
    clearDraft = () => { this.draft = []; this.reconcile() }
}
