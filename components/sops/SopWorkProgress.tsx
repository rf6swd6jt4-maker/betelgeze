"use client"
import { useEffect, useRef, useState } from "react"
import { useWorkspaceNavigation } from "@/components/workspace/WorkspaceNavigation"
import type { RelationshipQueuePage } from "@/lib/relationship-service-plan"
export type SopWorkProgressState = { status: string; progress: number; label: string; error: string | null }
export function SopWorkProgress({ endpoint, instanceId, userId, initialError, onComplete, onClose, recovery }: {
    endpoint: string; instanceId: string | null; userId: string; initialError?: string; onComplete: (queue: RelationshipQueuePage) => void; onClose: () => void; recovery?: React.ReactNode
}) {
    const active = useWorkspaceNavigation()?.active ?? true
    const [state, setState] = useState<SopWorkProgressState>({ status: "pending", progress: 0, label: "Saving the service", error: null })
    const [readError, setReadError] = useState(""), [retry, setRetry] = useState(0)
    const complete = useRef(onComplete), terminal = useRef(false)
    useEffect(() => { complete.current = onComplete }, [onComplete])
    useEffect(() => {
        if (!instanceId || !active || terminal.current) return
        let stopped = false, timer: ReturnType<typeof setTimeout> | undefined, controller: AbortController | null = null
        const deadline = Date.now() + 8 * 60_000
        const read = async <T,>(url: string, signal: AbortSignal): Promise<T> => {
            const response = await fetch(url, { cache: "no-store", credentials: "same-origin", redirect: "error", headers: { "x-workspace-user": userId }, signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]) })
            const data = await response.json()
            if (!response.ok) throw new Error(data.error ?? "Progress could not be checked.")
            return data
        }
        const check = async () => {
            if (stopped || terminal.current || document.visibilityState === "hidden" || controller) return
            if (Date.now() > deadline) { setReadError("This is taking longer than expected. Check progress again; generation may still finish in the background."); return }
            controller = new AbortController()
            const signal = controller.signal
            try {
                const value = await read<SopWorkProgressState>(`${endpoint}?kind=generation&id=${instanceId}`, signal)
                if (stopped) return
                if (value.status === "published") {
                    setState({ ...value, progress: 95, label: "Loading the updated queue" })
                    const queue = await read<RelationshipQueuePage>(`${endpoint}?kind=queue&offset=0`, signal)
                    if (stopped) return
                    terminal.current = true
                    setState(value); setReadError(""); complete.current(queue)
                } else {
                    setState(value); setReadError("")
                    if (["failed", "unavailable"].includes(value.status)) terminal.current = true
                    else timer = setTimeout(() => void check(), 2500)
                }
            } catch (error) {
                if (!stopped) setReadError(error instanceof Error ? `${error.message} Check progress again; this does not restart generation.` : "Progress could not be checked. Generation may continue in the background.")
            } finally { controller = null }
        }
        const visibility = () => { if (document.visibilityState === "visible") { clearTimeout(timer); void check() } else clearTimeout(timer) }
        void check(); document.addEventListener("visibilitychange", visibility)
        return () => { stopped = true; clearTimeout(timer); controller?.abort(); document.removeEventListener("visibilitychange", visibility) }
    }, [endpoint, instanceId, userId, active, retry])
    const error = initialError || state.error || readError
    return <div aria-label="Work generation progress"><div className="mb-3 flex items-center justify-between gap-3 text-sm"><p role="status" className="text-neutral-300">{state.label}</p><span className="text-neutral-500">{state.progress}%</span></div><div role="progressbar" aria-label="Generating work" aria-valuemin={0} aria-valuemax={100} aria-valuenow={state.progress} aria-valuetext={`${state.progress}% — ${state.label}`} className="h-2 overflow-hidden rounded-full bg-neutral-800"><div className="h-full rounded-full bg-white" style={{ width: `${state.progress}%` }} /></div>
        {error ? <p role="alert" className="mt-3 text-sm leading-6 text-red-300">{error}{state.status === "failed" ? " No flow was generated." : ""}</p> : null}
        <div className="mt-4 flex flex-wrap justify-end gap-3">{recovery}{readError ? <button type="button" className="min-h-11 text-sm text-neutral-300 underline" onClick={() => setRetry(n => n + 1)}>Check progress again</button> : null}{instanceId || initialError ? <button type="button" className="min-h-11 px-3 text-sm text-neutral-400" onClick={onClose}>Close</button> : null}</div>
    </div>
}
