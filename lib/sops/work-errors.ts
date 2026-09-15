/** Bounded, single-line diagnostics. Never expose arbitrary provider/database payloads. */
export function compactWorkError(message: string, max = 160) {
    const line = message.replace(/[\p{Cc}\p{Cf}]/gu, ' ').replace(/\s+/g, ' ').trim()
    const chars = Array.from(line)
    return chars.length > max ? chars.slice(0, max - 1).join('') + '…' : line
}
export function workFailureMessage(error: unknown) {
    if (error instanceof SyntaxError) return 'Work response contained invalid JSON; the saved response is available for diagnosis.'
    if (error instanceof Error && /^(OpenAI |Client |Service |SOP |The SOP |The work |A task |Work |Could not |An onboarding |Onboarding )/.test(error.message)) return compactWorkError(error.message)
    if (error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name)) return 'Work generation timed out; check the saved run before retrying.'
    return 'Work generation failed unexpectedly; inspect the saved run before retrying.'
}
export function workDatabaseError(stage: string, error: { code?: string; message?: string }) {
    const allowed = /^(The (service|SOP|work)|Service |Run lease |Invalid |Missing |Unsupported |Asset selection |Image does not |Choose |Link |Use an active |Relationship access |Work-generation )/
    const detail = error.message && allowed.test(error.message) ? error.message : `database ${String(error.code ?? 'unavailable').slice(0, 24)}`
    return compactWorkError(`Work ${stage}: ${detail}`)
}
