export type ConversationCurve = readonly [number, number, number, number]

// A quick, non-overshooting arrival shared by keyboard movement and its handoff.
export const CONVERSATION_CURVE: ConversationCurve = [0.22, 0.72, 0.18, 1]
export const conversationEasing = (curve: ConversationCurve) => `cubic-bezier(${curve.join(",")})`

function value(t: number, a: number, b: number) {
    return 3 * (1 - t) ** 2 * t * a + 3 * (1 - t) * t * t * b + t ** 3
}
function derivative(t: number, a: number, b: number) {
    return 3 * (1 - t) ** 2 * a + 6 * (1 - t) * t * (b - a) + 3 * t * t * (1 - b)
}

/** CSS cubic-bezier velocity, in progress per unit of elapsed time. This is
 * evaluated only when a measured endpoint changes, never in a frame loop. */
export function conversationCurveVelocity(curve: ConversationCurve, progress: number) {
    const time = Math.max(0, Math.min(1, progress))
    let lower = 0, upper = 1
    for (let i = 0; i < 24; i++) {
        const t = (lower + upper) / 2
        if (value(t, curve[0], curve[2]) < time) lower = t
        else upper = t
    }
    const t = (lower + upper) / 2
    return derivative(t, curve[1], curve[3]) / Math.max(0.000001, derivative(t, curve[0], curve[2]))
}

/** Match current speed instead of restarting an ease-out on every Android or
 * Safari viewport correction. Control points stay inside the unit square, so
 * an endpoint revision cannot introduce a bounce past either measured edge. */
export function continueConversationCurve(velocity: number, distance: number, duration: number): ConversationCurve {
    if (!Number.isFinite(velocity) || !Number.isFinite(distance) || !Number.isFinite(duration)
        || Math.abs(distance) < 0.5 || duration <= 0) return CONVERSATION_CURVE
    const slope = velocity * duration / distance
    return [0.22, Math.max(0, Math.min(1, slope * 0.22)), 0.42, 1]
}
