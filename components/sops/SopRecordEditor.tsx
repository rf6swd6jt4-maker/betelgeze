"use client"
import { useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { DetailDangerAction, DetailDangerButton, DetailDangerZone } from "@/components/detail"
import { flushWorkspaceAutosaves } from "@/lib/workspace-mutations"
import type { SopRecord } from "@/lib/sops/records-policy"
import { sopCommand } from "./client"
export function SopRecordEditor({ workspaceSlug, sop }: { workspaceSlug: string; workspaceId: string; userId: string; sop: SopRecord; mode: "danger" }) {
    const router = useRouter(), busyRef = useRef(false)
    const [busy, setBusy] = useState(false), [error, setError] = useState("")
    async function save() {
        if (busyRef.current) return
        busyRef.current = true; setBusy(true); setError("")
        try {
            if (!await flushWorkspaceAutosaves()) throw new Error("Finish saving the SOP fields before archiving.")
            const endpoint = `/api/workspaces/${workspaceSlug}/sops/${sop.id}`
            const current = await sopCommand(endpoint, undefined, "GET")
            await sopCommand(endpoint, { title: current.title, description: current.description, version: current.version, archived: !sop.archived_at }, "PATCH")
            router.refresh()
        } catch (e) { setError(e instanceof Error ? e.message : "Could not save SOP.") }
        finally { busyRef.current = false; setBusy(false) }
    }
    return <DetailDangerZone><DetailDangerAction title={sop.archived_at ? "Restore SOP" : "Archive SOP"} description={sop.archived_at ? "Return this SOP to the Library." : "Remove this SOP from the active Library. Assets and history remain available."} control={<DetailDangerButton disabled={busy} onClick={() => { if (sop.archived_at || window.confirm(`Archive “${sop.title}”? Assets and history will be preserved.`)) void save() }}>{busy ? "Saving…" : sop.archived_at ? "Restore SOP" : "Archive SOP"}</DetailDangerButton>} />{error ? <p role="alert" className="py-3 text-sm text-red-300">{error}</p> : null}<DetailDangerAction title="Delete SOP permanently" description="Permanent deletion is unavailable while source and interpretation history are retained." control={<DetailDangerButton tone="delete" disabled>Delete permanently</DetailDangerButton>} /></DetailDangerZone>
}
