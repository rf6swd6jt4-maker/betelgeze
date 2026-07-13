export function ganttDragDayDelta(pixelDelta: number, dayWidth: number) {
    if (!Number.isFinite(pixelDelta) || !Number.isFinite(dayWidth) || dayWidth <= 0) return 0
    return Math.round(pixelDelta / dayWidth)
}

export function ganttAnchoredScrollLeft({
    timelineDay,
    dayWidth,
    leftWidth,
    localX,
}: {
    timelineDay: number
    dayWidth: number
    leftWidth: number
    localX: number
}) {
    return Math.max(0, leftWidth + timelineDay * dayWidth - localX)
}

export function ganttArrowHeadPath(targetBarLeft: number, targetDivider: number, y: number, arrowSize = 4) {
    if (targetBarLeft - targetDivider < arrowSize + 1) return null
    return `M ${targetBarLeft - arrowSize} ${y - arrowSize} L ${targetBarLeft} ${y} L ${targetBarLeft - arrowSize} ${y + arrowSize}`
}
