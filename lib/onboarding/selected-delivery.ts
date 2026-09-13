import type { MessagingChoice, MessagingMethod } from "../relationship-contacts"

export function selectedOnboardingDestinations(payload: Record<string, unknown> | null, current: MessagingChoice[]) {
    if (!payload || !("delivery_choices" in payload)) return null
    const choices = payload.delivery_choices as Array<{ provider: MessagingMethod; address: string }>
    if (!Array.isArray(choices) || !choices.length || choices.length > 2 || new Set(choices.map(choice => choice?.provider)).size !== choices.length) throw new Error("The saved delivery choices need review.")
    return choices.map((choice, index) => {
        if (!current.some(candidate => candidate.provider === choice.provider && candidate.address === choice.address && candidate.state === "active" && candidate.canSend)) throw new Error("A chosen contact method changed or is unavailable. Restore its confirmed connection before retrying this link.")
        return { provider: choice.provider, address: `${choice.provider === "meta_whatsapp" ? "whatsapp" : "sms"}:${choice.address}`, channelId: null, primary: index === 0 }
    })
}
