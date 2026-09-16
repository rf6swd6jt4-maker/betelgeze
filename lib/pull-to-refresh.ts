export const PULL_TO_REFRESH_THRESHOLD = 64
export const PULL_TO_REFRESH_MAX_DISTANCE = 88

export type PullToRefreshGesture = {
    startX: number
    startY: number
    distance: number
    cancelled: boolean
}

export function beginPullToRefreshGesture(x: number, y: number): PullToRefreshGesture {
    return { startX: x, startY: y, distance: 0, cancelled: false }
}

export function updatePullToRefreshGesture(gesture: PullToRefreshGesture, x: number, y: number) {
    if (gesture.cancelled) return gesture
    const horizontalDistance = Math.abs(x - gesture.startX)
    const verticalDistance = y - gesture.startY
    if (verticalDistance < 0 || horizontalDistance > Math.max(12, verticalDistance)) {
        return { ...gesture, distance: 0, cancelled: true }
    }
    return {
        ...gesture,
        distance: Math.min(PULL_TO_REFRESH_MAX_DISTANCE, Math.max(0, verticalDistance * 0.55)),
    }
}

export function shouldRefreshFromPull(gesture: PullToRefreshGesture) {
    return !gesture.cancelled && gesture.distance >= PULL_TO_REFRESH_THRESHOLD
}

export function pullCanStartAt(target: EventTarget | null, scrollingElement: Element | null) {
    if (!(target instanceof Element)) return false
    if (target.closest("input, textarea, select, [contenteditable='true'], [data-pull-refresh-disabled]")) return false
    for (let element: Element | null = target; element; element = element.parentElement) {
        if (element.scrollTop > 0) return false
        if (element === scrollingElement) break
    }
    return !scrollingElement || scrollingElement.scrollTop <= 0
}
