import type { MentionPerson, RecordReferenceResult, ReferenceContext } from "../chat-formatting"

export type { ReferenceContext }
export type ComposerMentionSuggestion = { type: "person"; id: string; label: string; person: MentionPerson } | RecordReferenceResult

export function referenceContextKey(context?: ReferenceContext) {
    return context ? `${context.userId}:${context.workspaceId}:${context.workspaceSlug}:${context.conversationId}` : ""
}

export function suggestionKey(suggestion: ComposerMentionSuggestion) { return `${suggestion.type}:${suggestion.id}` }

/** Reuse authorised resident conversations; only managers may start a new DM. */
export function personMentionDestinations(input: {
    workspaceSlug: string
    currentUserId: string
    canStartDirect: boolean
    people: ReadonlyArray<{ id: string; former?: boolean }>
    conversations: ReadonlyArray<{ id: string; kind: string; memberIds: string[]; archived: boolean; system?: boolean }>
}) {
    const allowed = new Set(input.people.filter(person => !person.former && person.id !== input.currentUserId).map(person => person.id))
    const prefix = `/${encodeURIComponent(input.workspaceSlug)}/communications?mode=team&`
    const destinations = new Map<string, string>()
    if (input.canStartDirect) for (const id of allowed) destinations.set(id, `${prefix}dm=${encodeURIComponent(id)}`)
    for (const conversation of input.conversations) {
        if (conversation.kind !== "direct" || conversation.archived || conversation.system || !conversation.memberIds.includes(input.currentUserId)) continue
        const other = conversation.memberIds.find(id => id !== input.currentUserId)
        if (other && allowed.has(other)) destinations.set(other, `${prefix}nativeConversation=${encodeURIComponent(conversation.id)}`)
    }
    return destinations
}

/** Four choices across all types, exact labels first, preserving server relevance. */
export function composerMentionSuggestions(people: MentionPerson[], references: RecordReferenceResult[], query: string): ComposerMentionSuggestion[] {
    const normalized = query.trim().toLocaleLowerCase()
    const words = normalized.split(/\s+/)
    const peopleMatches: ComposerMentionSuggestion[] = people.filter(person => words.every(word => person.name.toLocaleLowerCase().includes(word))).map(person => ({ type: "person", id: person.id, label: person.name, person }))
    const seen = new Set<string>()
    // Interleave identities so one type cannot fill every slot before the user searches.
    const candidates: ComposerMentionSuggestion[] = []
    for (let index = 0; index < Math.max(peopleMatches.length, references.length); index++) {
        if (peopleMatches[index]) candidates.push(peopleMatches[index])
        if (references[index]) candidates.push(references[index])
    }
    return candidates.filter(item => {
        const key = suggestionKey(item)
        if (seen.has(key)) return false
        seen.add(key)
        return true
    }).sort((left, right) => Number(right.label.toLocaleLowerCase() === normalized) - Number(left.label.toLocaleLowerCase() === normalized)).slice(0, 4)
}
