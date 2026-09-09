export type ImageZoomPoint = { x: number; y: number }
export type ImageZoom = ImageZoomPoint & { scale: number }
export type ImageZoomBounds = { width: number; height: number; viewportWidth: number; viewportHeight: number }

export function clampImageZoom(value: ImageZoom, bounds: ImageZoomBounds): ImageZoom {
    const scale = Math.min(5, Math.max(1, value.scale))
    const maxX = Math.max(0, (bounds.width * scale - bounds.viewportWidth) / 2)
    const maxY = Math.max(0, (bounds.height * scale - bounds.viewportHeight) / 2)
    return { scale, x: maxX ? Math.max(-maxX, Math.min(maxX, value.x)) : 0, y: maxY ? Math.max(-maxY, Math.min(maxY, value.y)) : 0 }
}

// Points are relative to the centre of the viewer, matching the image's transform origin.
export function moveImageZoom(value: ImageZoom, before: ImageZoomPoint[], after: ImageZoomPoint[], bounds: ImageZoomBounds): ImageZoom {
    if (!before.length || before.length !== after.length) return value
    const midpoint = (points: ImageZoomPoint[]) => points.length === 1 ? points[0] : { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 }
    const distance = (points: ImageZoomPoint[]) => Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y)
    const start = midpoint(before)
    const end = midpoint(after)
    const scale = before.length > 1 ? Math.min(5, Math.max(1, value.scale * distance(after) / Math.max(1, distance(before)))) : value.scale
    const ratio = scale / value.scale
    return clampImageZoom({ scale, x: end.x - (start.x - value.x) * ratio, y: end.y - (start.y - value.y) * ratio }, bounds)
}
