"use client"

import {
    createWorkspacePerformanceMeasurement,
    type WorkspacePerformanceBoundary,
    type WorkspacePerformanceOutcome,
    type WorkspacePerformanceSample,
    type WorkspacePerformanceStart,
} from "@/lib/workspace-performance-contract"

const MAX_BUFFERED_SAMPLES = 100
const MAX_BATCH_SIZE = 20
const pending = new Map<string, WorkspacePerformanceSample[]>()
let flushTimer: ReturnType<typeof setTimeout> | null = null
let listening = false

declare global {
    interface Window {
        /** Content-free samples for the opt-in browser benchmark harness; bounded per document. */
        __BETELGEZE_PERFORMANCE_SAMPLES__?: WorkspacePerformanceSample[]
        __BETELGEZE_PERFORMANCE_DROPPED__?: number
    }
}

function flushWorkspacePerformance() {
    if (flushTimer !== null) clearTimeout(flushTimer)
    flushTimer = null
    for (const [workspaceSlug, samples] of pending) {
        pending.delete(workspaceSlug)
        for (let offset = 0; offset < samples.length; offset += MAX_BATCH_SIZE) {
            const body = JSON.stringify({ samples: samples.slice(offset, offset + MAX_BATCH_SIZE) })
            const endpoint = `/api/workspaces/${encodeURIComponent(workspaceSlug)}/performance/interactions`
            if (navigator.sendBeacon?.(endpoint, new Blob([body], { type: "application/json" }))) continue
            void fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => undefined)
        }
    }
}

function record(workspaceSlug: string, sample: WorkspacePerformanceSample) {
    const history = window.__BETELGEZE_PERFORMANCE_SAMPLES__ ??= []
    history.push(sample)
    if (history.length > MAX_BUFFERED_SAMPLES) history.splice(0, history.length - MAX_BUFFERED_SAMPLES)
    window.dispatchEvent(new CustomEvent("betelgeze:performance-sample", { detail: sample }))
    const batch = pending.get(workspaceSlug) ?? []
    if (batch.length >= MAX_BUFFERED_SAMPLES) {
        batch.shift()
        window.__BETELGEZE_PERFORMANCE_DROPPED__ = (window.__BETELGEZE_PERFORMANCE_DROPPED__ ?? 0) + 1
    }
    batch.push(sample)
    pending.set(workspaceSlug, batch)
    if (!listening) {
        listening = true
        window.addEventListener("pagehide", flushWorkspacePerformance)
        document.addEventListener("visibilitychange", () => {
            if (document.visibilityState === "hidden") flushWorkspacePerformance()
        })
    }
    if (flushTimer === null) flushTimer = setTimeout(flushWorkspacePerformance, 10_000)
}

/** Mark meaningful UI/server boundaries explicitly. Never mark headers as a server acknowledgement. */
export function beginWorkspaceInteraction(input: Omit<WorkspacePerformanceStart, "sampleId"> & { workspaceSlug: string }): {
    mark(boundary: WorkspacePerformanceBoundary): void
    finish(outcome: WorkspacePerformanceOutcome, boundary?: WorkspacePerformanceBoundary): void
} {
    if (typeof window === "undefined" || !/^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/.test(input.workspaceSlug)) {
        return { mark: () => {}, finish: () => {} }
    }
    const measurement = createWorkspacePerformanceMeasurement({ ...input, sampleId: crypto.randomUUID() }, () => performance.now(), document.visibilityState === "visible")
    let finished = false
    const visibility = () => measurement.visibility(document.visibilityState === "visible")
    const freeze = () => measurement.suspend()
    const pagehide = () => finish("aborted")
    document.addEventListener("visibilitychange", visibility)
    document.addEventListener("freeze", freeze)
    window.addEventListener("pagehide", pagehide)
    // Unfinished work must remain visible in measurements, without retaining listeners indefinitely.
    const timer = setTimeout(() => finish("timeout"), 120_000)
    function finish(outcome: WorkspacePerformanceOutcome, completionBoundary?: WorkspacePerformanceBoundary) {
        if (finished) return
        finished = true
        clearTimeout(timer)
        document.removeEventListener("visibilitychange", visibility)
        document.removeEventListener("freeze", freeze)
        window.removeEventListener("pagehide", pagehide)
        const sample = measurement.finish(outcome, completionBoundary)
        if (sample) record(input.workspaceSlug, sample)
        if (outcome === "aborted") flushWorkspacePerformance()
    }
    return { mark: measurement.mark, finish }
}
