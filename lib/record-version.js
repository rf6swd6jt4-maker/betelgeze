/** Preserve PostgreSQL microseconds while normalizing equivalent UTC strings.
 * @param {string} value
 */
export function recordVersionKey(value) {
    const time = Date.parse(value)
    if (!Number.isFinite(time)) return value
    const fraction = /[T ]\d{2}:\d{2}:\d{2}(?:\.(\d+))?/.exec(value)?.[1] ?? ""
    return `${new Date(time).toISOString().slice(0, 19)}.${fraction.padEnd(6, "0").slice(0, 6)}`
}

/** @param {string} left @param {string} right */
export function recordVersionAfter(left, right) { return recordVersionKey(left) > recordVersionKey(right) }

/** Reconcile a refreshed text field without lending a dirty draft a newer
 * optimistic version for text the user never saw.
 * @param {{value: string, baseline: string, version: string, conflict: {value: string, version: string} | null}} draft
 * @param {{value: string, version: string}} incoming
 */
export function reconcileRecordTextDraft(draft, incoming) {
    if (!recordVersionAfter(incoming.version, draft.version)) return draft
    if (draft.conflict && recordVersionAfter(draft.conflict.version, incoming.version)) return draft
    if (draft.value === draft.baseline || draft.value === incoming.value) {
        return { value: incoming.value, baseline: incoming.value, version: incoming.version, conflict: null }
    }
    // A different field changed; this text is still based on the current value.
    if (incoming.value === draft.baseline) return { ...draft, version: incoming.version, conflict: null }
    return { ...draft, conflict: incoming }
}
