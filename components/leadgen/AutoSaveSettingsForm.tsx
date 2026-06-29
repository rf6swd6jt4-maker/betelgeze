"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"

type SaveState = "idle" | "waiting" | "saving" | "saved"

export function AutoSaveSettingsForm({ action, children }: { action: (formData: FormData) => void | Promise<void>; children: ReactNode }) {
    const formRef = useRef<HTMLFormElement>(null)
    const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const savingRef = useRef(false)
    const queuedRef = useRef(false)
    const [state, setState] = useState<SaveState>("idle")

    function clearPendingSave() {
        if (!timeoutRef.current) return
        clearTimeout(timeoutRef.current)
        timeoutRef.current = null
    }

    function submitWhenReady() {
        timeoutRef.current = null
        if (savingRef.current) {
            queuedRef.current = true
            setState("waiting")
            return
        }
        savingRef.current = true
        queuedRef.current = false
        setState("saving")
        formRef.current?.requestSubmit()
    }

    function scheduleSave() {
        clearPendingSave()
        setState("waiting")
        timeoutRef.current = setTimeout(submitWhenReady, 900)
    }

    useEffect(() => clearPendingSave, [])

    return <form
        ref={formRef}
        action={async (formData) => {
            try {
                await action(formData)
                if (queuedRef.current) {
                    setState("waiting")
                    window.setTimeout(submitWhenReady, 120)
                    return
                }
                setState("saved")
                window.setTimeout(() => setState("idle"), 1800)
            } finally {
                savingRef.current = false
            }
        }}
        onChange={(event) => {
            const target = event.target
            if (!(target instanceof HTMLElement)) return
            const hasNamedField = target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement
                ? Boolean(target.name)
                : false
            if (!hasNamedField && !target.closest("[data-autosave-control]")) return
            scheduleSave()
        }}
        onInput={(event) => {
            const target = event.target
            if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) return
            if (!target.name) return
            if (["checkbox", "radio", "file"].includes(target.type)) return
            scheduleSave()
        }}
        onClick={(event) => {
            const target = event.target
            if (!(target instanceof HTMLElement)) return
            if (!target.closest("[data-autosave-control]")) return
            scheduleSave()
        }}
        className="mt-8 space-y-4"
    >
        <div className="sticky top-3 z-30 flex justify-end pointer-events-none">
            <span className={`rounded-full border px-3 py-1 text-xs shadow-lg transition ${state === "saving" || state === "waiting" ? "border-amber-400/30 bg-amber-400/10 text-amber-100" : state === "saved" ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-100" : "border-neutral-800 bg-neutral-950/80 text-neutral-500"}`}>
                {state === "waiting" ? "Autosave pending" : state === "saving" ? "Saving" : state === "saved" ? "Saved" : "Autosave on"}
            </span>
        </div>
        {children}
    </form>
}
