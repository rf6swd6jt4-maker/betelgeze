export function ganttDragDayDelta(pixelDelta: number, dayWidth: number) {
    if (!Number.isFinite(pixelDelta) || !Number.isFinite(dayWidth) || dayWidth <= 0) return 0
    return Math.round(pixelDelta / dayWidth)
}

export function ganttAnchoredScrollLeft({
    timelineDay,
    dayWidth,
    leftWidth,
    localX,
    gutter = 0,
}: {
    timelineDay: number
    dayWidth: number
    leftWidth: number
    localX: number
    // Empty space padded before the first day so an edge day can still be
    // scrolled to the centre of the viewport instead of clamping short.
    gutter?: number
}) {
    return Math.max(0, leftWidth + gutter + timelineDay * dayWidth - localX)
}

export function ganttArrowHeadPath(targetBarLeft: number, targetDivider: number, y: number, arrowSize = 4) {
    if (targetBarLeft - targetDivider < arrowSize + 1) return null
    return `M ${targetBarLeft - arrowSize} ${y - arrowSize} L ${targetBarLeft} ${y} L ${targetBarLeft - arrowSize} ${y + arrowSize}`
}
