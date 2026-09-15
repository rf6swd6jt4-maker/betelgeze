export function resolveSettingsSectionIndex({
    tops,
    currentIndex,
    activationLine,
    hysteresis = 28,
    atEnd = false,
}: {
    tops: number[]
    currentIndex: number
    activationLine: number
    hysteresis?: number
    atEnd?: boolean
}) {
    if (!tops.length) return -1
    if (atEnd) return tops.length - 1

    let nextIndex = Math.min(Math.max(currentIndex, 0), tops.length - 1)

    // Reconcile from geometry in both directions. Scroll restoration and
    // streamed section growth can move content without changing scrollTop, so
    // the last scroll direction is not a reliable description of the viewport.
    while (nextIndex < tops.length - 1 && tops[nextIndex + 1] <= activationLine - hysteresis) {
        nextIndex += 1
    }
    while (nextIndex > 0 && tops[nextIndex] > activationLine + hysteresis) {
        nextIndex -= 1
    }

    return nextIndex
}
