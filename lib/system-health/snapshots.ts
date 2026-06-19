import { supabaseAdmin } from "@/lib/supabase/admin"
import type { LiveMetric } from "@/lib/system-health/live-metrics"

export type MetricHistoryPoint = {
    metric_id: string
    numeric_value: number
    numeric_limit: number | null
    captured_at: string
}

export async function recordHealthMetricSnapshots(metrics: LiveMetric[]) {
    const rows = metrics
        .filter(
            (metric) =>
                typeof metric.chartValue === "number" &&
                Number.isFinite(metric.chartValue)
        )
        .map((metric) => ({
            metric_id: metric.id,
            provider: metric.provider,
            metric_name: metric.name,
            numeric_value: metric.chartValue,
            numeric_limit: metric.chartLimit ?? null,
            status: metric.status,
        }))

    if (rows.length === 0) return

    try {
        await supabaseAdmin.from("system_health_metric_snapshots").insert(rows)
    } catch {
        // Health monitoring must not make the admin page unavailable.
    }
}

export async function getHealthMetricHistories(metricIds: string[]) {
    if (metricIds.length === 0) return new Map<string, MetricHistoryPoint[]>()

    try {
        const { data, error } = await supabaseAdmin
            .from("system_health_metric_snapshots")
            .select("metric_id, numeric_value, numeric_limit, captured_at")
            .in("metric_id", metricIds)
            .order("captured_at", { ascending: false })
            .limit(metricIds.length * 5)

        if (error || !data) return new Map<string, MetricHistoryPoint[]>()

        const histories = new Map<string, MetricHistoryPoint[]>()

        for (const point of data as MetricHistoryPoint[]) {
            const points = histories.get(point.metric_id) ?? []
            if (points.length < 5) points.push(point)
            histories.set(point.metric_id, points)
        }

        for (const [metricId, points] of histories) {
            histories.set(metricId, points.reverse())
        }

        return histories
    } catch {
        return new Map<string, MetricHistoryPoint[]>()
    }
}
