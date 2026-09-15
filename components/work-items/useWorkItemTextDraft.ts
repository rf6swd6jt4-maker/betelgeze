"use client"
import { useCallback, useEffect, useRef, useState } from "react"
import { useRouter } from "@/components/workspace/WorkspaceNavigation"
import { registerWorkspaceAutosaveFlusher, runWorkspaceMutation } from "@/lib/workspace-mutations"
import { recordVersionAfter, reconcileRecordTextDraft } from "@/lib/record-version"
import { postGanttSync } from "@/lib/ui/gantt-sync"

type SaveResult = { ok: true; version: string } | { ok: false; error: string; conflict?: boolean }
export function useWorkItemTextDraft(props: { workspaceSlug: string; workItemId: string; updatedAt: string; description: string | null; label: string; onSaved?: () => void; save: (value: string, version: string, baseline: string) => Promise<SaveResult> }) {
    const router = useRouter()
    const persist = props.save
    const onSaved = props.onSaved
    const [description, setDescription] = useState(props.description ?? "")
    const [descriptionBaseline, setDescriptionBaseline] = useState(props.description ?? "")
    const [descriptionSaveState, setDescriptionSaveState] = useState<"idle" | "dirty" | "saving" | "saved" | "error">("idle")
    const [descriptionError, setDescriptionError] = useState<string | null>(null)
    const [descriptionConflict, setDescriptionConflict] = useState<{ value: string; version: string } | null>(null)
    const descriptionRef = useRef<HTMLTextAreaElement>(null)
    const descriptionTimerRef = useRef<number | null>(null)
    const descriptionPromiseRef = useRef<Promise<boolean> | null>(null)
    const descriptionVersionRef = useRef(props.updatedAt)
    const latestDescriptionRef = useRef(description)
    const descriptionBaselineRef = useRef(descriptionBaseline)
    const descriptionConflictRef = useRef(descriptionConflict)
    const incomingDescriptionRef = useRef({ value: props.description ?? "", version: props.updatedAt })
    useEffect(() => {
        const textarea = descriptionRef.current
        if (!textarea) return
        textarea.style.height = "auto"
        textarea.style.height = `${Math.max(props.label === "Instructions" ? 80 : props.label === "Name" ? 24 : 48, textarea.scrollHeight)}px`
    }, [description, props.label])

    const reconcileDescription = useCallback(() => {
        const previous = { value: latestDescriptionRef.current, baseline: descriptionBaselineRef.current, version: descriptionVersionRef.current, conflict: descriptionConflictRef.current }
        const next = reconcileRecordTextDraft(previous, incomingDescriptionRef.current)
        if (next === previous) return
        latestDescriptionRef.current = next.value
        descriptionBaselineRef.current = next.baseline
        descriptionVersionRef.current = next.version
        descriptionConflictRef.current = next.conflict
        setDescription(next.value)
        setDescriptionBaseline(next.baseline)
        setDescriptionConflict(next.conflict)
        setDescriptionSaveState(next.conflict ? "error" : next.value === next.baseline ? "idle" : "dirty")
        setDescriptionError(next.conflict ? `${props.label} changed elsewhere. Your draft is preserved; use the latest version before editing again.` : null)
    }, [props.label])

    useEffect(() => {
        const incoming = { value: props.description ?? "", version: props.updatedAt }
        if (recordVersionAfter(incoming.version, incomingDescriptionRef.current.version)) incomingDescriptionRef.current = incoming
        // A snapshot can arrive before the acknowledgement of our own write.
        // Reconcile it against the acknowledged baseline when that write ends.
        if (!descriptionPromiseRef.current) reconcileDescription()
    }, [props.description, props.updatedAt, reconcileDescription])

    const saveDescription = useCallback(async (): Promise<boolean> => {
        if (descriptionTimerRef.current) {
            window.clearTimeout(descriptionTimerRef.current)
            descriptionTimerRef.current = null
        }
        if (descriptionPromiseRef.current) return descriptionPromiseRef.current
        if (descriptionConflictRef.current) return false
        const drain = async () => {
            while (latestDescriptionRef.current !== descriptionBaselineRef.current) {
                if (descriptionConflictRef.current) return false
                const submitted = latestDescriptionRef.current
                setDescriptionSaveState("saving")
                setDescriptionError(null)
                const outcome = await runWorkspaceMutation(() => persist(submitted, descriptionVersionRef.current, descriptionBaselineRef.current), { category: "gantt" })
                if (!outcome.ok) {
                    setDescriptionSaveState("error")
                    setDescriptionError(outcome.error)
                    if (outcome.conflict) router.refresh()
                    return false
                }
                descriptionVersionRef.current = outcome.version
                // The command stores trimmed text. Keep the acknowledged
                // baseline identical to the next server snapshot.
                const saved = submitted.trim()
                descriptionBaselineRef.current = saved
                setDescriptionBaseline(saved)
                if (latestDescriptionRef.current === submitted) {
                    latestDescriptionRef.current = saved
                    setDescription(saved)
                }
                reconcileDescription()
                if (descriptionConflictRef.current) return false
                if (latestDescriptionRef.current === saved) {
                    setDescriptionSaveState("saved")
                    if (onSaved) onSaved()
                    else postGanttSync(props.workspaceSlug)
                    return true
                }
            }
            return true
        }
        descriptionPromiseRef.current = drain().catch((error: unknown) => {
            setDescriptionSaveState("error")
            setDescriptionError(error instanceof Error ? error.message : "Description could not be saved")
            return false
        }).finally(() => {
            descriptionPromiseRef.current = null
            reconcileDescription()
        })
        return descriptionPromiseRef.current
    }, [persist, props.workspaceSlug, onSaved, reconcileDescription, router])

    useEffect(() => {
        const unregister = registerWorkspaceAutosaveFlusher(saveDescription)
        return () => {
            unregister()
            if (descriptionTimerRef.current) window.clearTimeout(descriptionTimerRef.current)
        }
    }, [saveDescription])

    useEffect(() => {
        if (description === descriptionBaseline || descriptionConflictRef.current) return
        if (descriptionTimerRef.current) window.clearTimeout(descriptionTimerRef.current)
        descriptionTimerRef.current = window.setTimeout(() => void saveDescription(), 800)
        return () => {
            if (descriptionTimerRef.current) window.clearTimeout(descriptionTimerRef.current)
        }
    }, [description, descriptionBaseline, props.updatedAt, saveDescription])

    return { value: description, baseline: descriptionBaseline, state: descriptionSaveState, error: descriptionError, conflict: descriptionConflict, ref: descriptionRef, save: saveDescription,
        change(value: string) {
            latestDescriptionRef.current = value
            setDescription(value)
            if (!descriptionConflictRef.current) { setDescriptionSaveState("dirty"); setDescriptionError(null) }
        },
        useLatest() {
            const incoming = descriptionConflictRef.current
            if (!incoming) return
            latestDescriptionRef.current = incoming.value
            descriptionBaselineRef.current = incoming.value
            descriptionVersionRef.current = incoming.version
            descriptionConflictRef.current = null
            setDescription(incoming.value); setDescriptionBaseline(incoming.value); setDescriptionConflict(null)
            setDescriptionSaveState("idle"); setDescriptionError(null); descriptionRef.current?.focus()
        },
    }
}
