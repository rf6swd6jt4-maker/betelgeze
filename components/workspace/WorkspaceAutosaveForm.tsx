"use client"

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type ReactNode, type SyntheticEvent } from "react"
import { createWorkspaceDraftJournal, type WorkspaceDraftScope } from "@/lib/workspace-draft-journal"
import { WorkspaceDraftRecovery } from "./WorkspaceDraftRecovery"
import {
    registerWorkspaceAutosaveFlusher,
    runWorkspaceMutation,
    type WorkspaceMutationResult,
} from "@/lib/workspace-mutations"

type SaveState = "idle" | "dirty" | "saving" | "saved" | "error"
type AutosaveResult = WorkspaceMutationResult<unknown> | void

function formSnapshot(formData: FormData) {
    return JSON.stringify([...formData.entries()].map(([key, value]) => [
        key,
        typeof value === "string" ? value : `${value.name}:${value.size}:${value.type}`,
    ]))
}

function failure(result: AutosaveResult) {
    return result && typeof result === "object" && result.ok === false ? result : null
}

function savesImmediately(target: EventTarget | null) {
    if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) return false
    return target instanceof HTMLSelectElement || ["checkbox", "radio", "date", "time", "number"].includes(target.type)
}

export function WorkspaceAutosaveForm(props: Parameters<typeof WorkspaceAutosaveFormContent>[0]) {
    return <WorkspaceAutosaveFormContent key={JSON.stringify(props.recoveryScope)} {...props} />
}

function WorkspaceAutosaveFormContent({
    action,
    children,
    className,
    debounceMs = 800,
    statusClassName = "mt-3 text-xs text-neutral-500",
    recoveryScope,
    recoveryFields,
}: {
    action: (formData: FormData) => AutosaveResult | Promise<AutosaveResult>
    children: ReactNode
    className?: string
    debounceMs?: number
    statusClassName?: string
    recoveryScope: WorkspaceDraftScope
    recoveryFields: readonly string[]
}) {
    const formRef = useRef<HTMLFormElement>(null)
    const timerRef = useRef<number | null>(null)
    const pendingRef = useRef<FormData | null>(null)
    const failedRef = useRef<FormData | null>(null)
    const savingPromiseRef = useRef<Promise<boolean> | null>(null)
    const lastSavedRef = useRef("")
    const mountedRef = useRef(true)
    const actionRef = useRef(action)
    const recoveryPendingRef = useRef(false)
    const [recoveryPending, setRecoveryPending] = useState(false)
    const scopeKey = JSON.stringify(recoveryScope)
    const fieldsKey = JSON.stringify(recoveryFields)
    const journal = useMemo(() => createWorkspaceDraftJournal(JSON.parse(scopeKey) as WorkspaceDraftScope, { maximum: 12_000 }), [scopeKey])
    const fields = useMemo(() => new Set<string>(JSON.parse(fieldsKey)), [fieldsKey])
    const lastSnapshotRef = useRef("")
    const [saveState, setSaveState] = useState<SaveState>("idle")
    const [saveError, setSaveError] = useState<string | null>(null)
    useLayoutEffect(() => { actionRef.current = action }, [action])
    const snapshot = useCallback(() => {
        if (formRef.current) {
            const data = new FormData(formRef.current)
            if ([...data].some(([key, value]) => !fields.has(key) || typeof value !== "string")) throw new Error("This form contains fields that cannot be recovered on this device.")
            lastSnapshotRef.current = formSnapshot(data)
        }
        return { value: lastSnapshotRef.current, baseline: lastSavedRef.current, version: "form-v1" }
    }, [fields])
    const checkpoint = useCallback(() => {
        try {
            const safe = journal.checkpoint(snapshot())
            if (!safe && mountedRef.current) { setSaveState("error"); setSaveError(journal.error()) }
            return safe
        } catch (error) {
            if (mountedRef.current) { setSaveState("error"); setSaveError(error instanceof Error ? error.message : "This draft could not be preserved.") }
            return false
        }
    }, [journal, snapshot])

    const saveLatest = useCallback(async () => {
        if (!journal.active() || recoveryPendingRef.current) return false
        const form = formRef.current
        if (!form || !form.checkValidity()) return false
        if (timerRef.current) {
            window.clearTimeout(timerRef.current)
            timerRef.current = null
        }
        const next = new FormData(form)
        if (formSnapshot(next) !== lastSavedRef.current) pendingRef.current = next
        if (savingPromiseRef.current) return savingPromiseRef.current

        const drain = async (): Promise<boolean> => {
            while (pendingRef.current) {
                if (!journal.active() || recoveryPendingRef.current) return false
                const submitted = pendingRef.current
                pendingRef.current = null
                const submittedSnapshot = formSnapshot(submitted)
                if (submittedSnapshot === lastSavedRef.current) continue
                if (mountedRef.current) {
                    setSaveState("saving")
                    setSaveError(null)
                }
                try {
                    const request = new FormData()
                    for (const [key, value] of submitted) request.append(key, value)
                    request.set("__workspace_expected_user", recoveryScope.userId)
                    const result = await runWorkspaceMutation(() => Promise.resolve(actionRef.current(request)))
                    if (!journal.active()) return false
                    const rejected = failure(result)
                    if (rejected) {
                        failedRef.current = submitted
                        if (mountedRef.current) {
                            setSaveState("error")
                            setSaveError(rejected.error)
                        }
                        return false
                    }
                    failedRef.current = null
                    lastSavedRef.current = submittedSnapshot
                    const currentForm = formRef.current
                    if (currentForm) {
                        const current = new FormData(currentForm)
                        if (formSnapshot(current) !== lastSavedRef.current) pendingRef.current = current
                    }
                    journal.acknowledge(snapshot())
                    if (recoveryPendingRef.current) { if (mountedRef.current) setSaveState("dirty"); return false }
                    if (mountedRef.current) setSaveState(pendingRef.current ? "saving" : "saved")
                } catch (error) {
                    if (!journal.active()) return false
                    failedRef.current = submitted
                    if (mountedRef.current) {
                        setSaveState("error")
                        setSaveError(error instanceof Error ? error.message : "These changes could not be saved.")
                    }
                    return false
                }
            }
            return true
        }

        savingPromiseRef.current = drain().finally(() => {
            savingPromiseRef.current = null
        })
        return savingPromiseRef.current
    }, [journal, recoveryScope.userId, snapshot])

    useEffect(() => {
        mountedRef.current = true
        const unregister = registerWorkspaceAutosaveFlusher(saveLatest, { checkpoint })
        return () => {
            mountedRef.current = false
            unregister()
            if (timerRef.current) window.clearTimeout(timerRef.current)
        }
    }, [saveLatest, checkpoint])

    useLayoutEffect(() => {
        journal.start()
        mountedRef.current = true
        if (!lastSavedRef.current && formRef.current) { lastSavedRef.current = formSnapshot(new FormData(formRef.current)); lastSnapshotRef.current = lastSavedRef.current }
        const unload = (event: BeforeUnloadEvent) => { if (!checkpoint()) { event.preventDefault(); event.returnValue = "" } }
        const pageHide = () => { checkpoint() }
        const accountClearing = (event: Event) => {
            if ((event as CustomEvent<{ preservedUserId?: string }>).detail?.preservedUserId === journal.userId) return
            checkpoint(); journal.stop()
        }
        window.addEventListener("beforeunload", unload)
        window.addEventListener("pagehide", pageHide)
        window.addEventListener("betelgeze:offline-account-clearing", accountClearing)
        return () => {
            mountedRef.current = false
            checkpoint()
            journal.stop()
            window.removeEventListener("beforeunload", unload)
            window.removeEventListener("pagehide", pageHide)
            window.removeEventListener("betelgeze:offline-account-clearing", accountClearing)
        }
    }, [checkpoint, journal])

    function schedule(event: SyntheticEvent<HTMLFormElement>) {
        if (!journal.active() || recoveryPendingRef.current) return
        failedRef.current = null
        setSaveError(null)
        setSaveState("dirty")
        if (timerRef.current) window.clearTimeout(timerRef.current)
        if (savesImmediately(event.target)) {
            void saveLatest()
            return
        }
        timerRef.current = window.setTimeout(() => void saveLatest(), debounceMs)
    }

    function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()
        if (!event.currentTarget.reportValidity()) return
        void saveLatest()
    }

    function retry() {
        if (failedRef.current) pendingRef.current = failedRef.current
        void saveLatest()
    }

    const status = recoveryPending ? "Review this draft before saving" : saveState === "saving"
        ? "Saving changes…"
        : saveState === "saved"
            ? "Saved"
            : saveState === "error"
                ? saveError ?? "These changes could not be saved."
                : saveState === "dirty"
                    ? "Changes will save automatically"
                    : "Changes save automatically"

    return <form
        ref={formRef}
        onSubmit={submit}
        onChange={schedule}
        onInput={schedule}
        onBlurCapture={() => { if (saveState === "dirty") void saveLatest() }}
        className={className}
        data-workspace-autosave="true"
    >
        {children}
        <div className={`flex items-center gap-2 ${statusClassName}`}>
            <p aria-live="polite" className={saveState === "error" ? "text-red-300" : undefined}>{status}</p>
            {saveState === "error" ? <button type="button" onClick={retry} className="text-red-200 underline decoration-red-500/50 underline-offset-2 hover:text-white">Retry</button> : null}
            {recoveryPending ? <button type="button" onClick={() => { recoveryPendingRef.current = false; setRecoveryPending(false); void saveLatest() }} className="text-amber-200 underline">Save reviewed draft</button> : null}
        </div>
        <WorkspaceDraftRecovery journal={journal} current={() => snapshot().value} label="Form" onRestore={(draft) => {
            try {
                const values: unknown = JSON.parse(draft.value)
                if (!Array.isArray(values) || values.some((entry) => !Array.isArray(entry) || entry.length !== 2 || !fields.has(entry[0]) || typeof entry[1] !== "string")) throw new Error("This saved form does not match the editable fields.")
                const form = formRef.current
                if (!form) return
                const changes = (values as [string, string][]).map(([key, value]) => {
                    const input = form.elements.namedItem(key)
                    if (!(input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement || input instanceof HTMLSelectElement) || (input instanceof HTMLInputElement && ["password", "file", "checkbox", "radio"].includes(input.type))) throw new Error("This field cannot be restored automatically.")
                    return { input, value }
                })
                journal.archive(snapshot())
                for (const { input, value } of changes) input.value = value
                recoveryPendingRef.current = true; setRecoveryPending(true); setSaveState("dirty"); setSaveError(null)
                checkpoint()
            } catch (error) { setSaveState("error"); setSaveError(error instanceof Error ? error.message : "This saved form could not be restored.") }
        }} />
    </form>
}
