type TrendStatus = "ok" | "warning" | "critical" | "unknown"

type TrendPoint = {
    capturedAt: string
    value: number
}

const COLORS: Record<TrendStatus, { line: string; fill: string }> = {
    ok: { line: "#34d399", fill: "#34d399" },
    warning: { line: "#fbbf24", fill: "#fbbf24" },
    critical: { line: "#fb7185", fill: "#fb7185" },
    unknown: { line: "#a3a3a3", fill: "#a3a3a3" },
}

export function MetricTrendChart({
    metricId,
    status,
    points,
    limit,
}: {
    metricId: string
    status: TrendStatus
    points: TrendPoint[]
    limit?: number
}) {
    const color = COLORS[status]
    const width = 240
    const height = 76
    const left = 8
    const right = 232
    const top = 8
    const bottom = 66
    const maximum = Math.max(limit ?? 0, ...points.map((point) => point.value), 1)
    const chartPoints = points.map((point, index) => {
        const x =
            points.length === 1
                ? width / 2
                : left + ((right - left) * index) / (points.length - 1)
        const y = bottom - ((bottom - top) * point.value) / maximum

        return { ...point, x, y }
    })
    const line = chartPoints.map((point) => `${point.x},${point.y}`).join(" ")
    const area = chartPoints.length
        ? `M ${chartPoints[0].x} ${bottom} L ${chartPoints
              .map((point) => `${point.x} ${point.y}`)
              .join(" L ")} L ${chartPoints[chartPoints.length - 1].x} ${bottom} Z`
        : ""
    const gradientId = `metric-gradient-${metricId.replace(/[^a-z0-9]/gi, "-")}`

    if (chartPoints.length === 0) {
        return (
            <div className="mt-3 flex h-[76px] items-center justify-center rounded-md border border-dashed border-neutral-800 bg-neutral-950/60 text-xs text-neutral-600">
                Trend data will appear after this migration is applied.
            </div>
        )
    }

    return (
        <div className="mt-3 h-[76px] overflow-hidden rounded-md border border-neutral-800 bg-neutral-950/60 px-1">
            <svg
                viewBox={`0 0 ${width} ${height}`}
                className="h-full w-full"
                role="img"
                aria-label={`Trend from the last ${chartPoints.length} checks`}
            >
                <defs>
                    <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
                        <stop offset="0%" stopColor={color.fill} stopOpacity="0.36" />
                        <stop offset="100%" stopColor={color.fill} stopOpacity="0.02" />
                    </linearGradient>
                </defs>
                {[20, 40, 60].map((y) => (
                    <line
                        key={y}
                        x1={left}
                        x2={right}
                        y1={y}
                        y2={y}
                        stroke="#262626"
                        strokeWidth="1"
                    />
                ))}
                <path d={area} fill={`url(#${gradientId})`} />
                {chartPoints.length > 1 && (
                    <polyline
                        points={line}
                        fill="none"
                        stroke={color.line}
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                    />
                )}
                {chartPoints.map((point) => (
                    <circle
                        key={point.capturedAt}
                        cx={point.x}
                        cy={point.y}
                        r="3"
                        fill="#0a0a0a"
                        stroke={color.line}
                        strokeWidth="2"
                    >
                        <title>
                            {new Date(point.capturedAt).toLocaleString("en-US", {
                                dateStyle: "medium",
                                timeStyle: "short",
                            })}: {point.value.toLocaleString("en-US")}
                        </title>
                    </circle>
                ))}
            </svg>
        </div>
    )
}
