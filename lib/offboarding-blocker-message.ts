export type OffboardingBlocker = { client: string; detail: string }

export const CLIENT_TEAM_GUARD = /Client-team handover must be completed/i
export const SHARED_QUEUE_GUARD = /shared service assignments/i

export function isOffboardingGuardMessage(text: string | null | undefined) {
    return Boolean(text && (CLIENT_TEAM_GUARD.test(text) || SHARED_QUEUE_GUARD.test(text)))
}

const SHOWN = 6

function listBlockers(blockers: OffboardingBlocker[], total: number) {
    const shown = blockers.slice(0, SHOWN).map((blocker) => `${blocker.client} (${blocker.detail})`)
    const hidden = Math.max(total, blockers.length) - shown.length
    return hidden > 0 ? `${shown.join("; ")}; and ${hidden} more` : shown.join("; ")
}

/** Plain-language refusal naming the clients and services a person is still tied to. */
export function offboardingBlockerMessage({ person, blockers, total, serviceName }: {
    person: string
    blockers: OffboardingBlocker[]
    total?: number
    serviceName?: string | null
}) {
    const target = serviceName ? `${person} from ${serviceName}` : `${person} from this workspace`
    if (!blockers.length) {
        return serviceName
            ? `${person} still has active work in shared ${serviceName} queues. Remove them from those shared service assignments first, then save again.`
            : `${person} is still assigned to active client work. Hand that work over first, then remove them.`
    }
    return `Can't remove ${target} yet. ${person} is still on: ${listBlockers(blockers, total ?? blockers.length)}. Hand these over or remove them from the shared service assignments first.`
}
