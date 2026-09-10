"use client"

import { useActionState } from "react"
import { useSearchParams, useWorkspaceNavigation } from "@/components/workspace/WorkspaceNavigation"
import { DetailDangerButton } from "@/components/detail"
import { WORKSPACE_TAB_FRAME_PARAM } from "@/lib/workspace-tabs"
import { runWorkspaceMutation } from "@/lib/workspace-mutations"

type ArchiveRelationshipState = { error?: string; href?: string }

export function ArchiveRelationshipForm({
    action,
    relationshipName,
}: {
    action: (state: ArchiveRelationshipState, formData: FormData) => Promise<ArchiveRelationshipState>
    relationshipName: string
}) {
    const navigation = useWorkspaceNavigation()
    const [state, formAction, pending] = useActionState(async (previous: ArchiveRelationshipState, formData: FormData) => {
        if (!navigation) return action(previous, formData)
        try {
            const result = await runWorkspaceMutation(() => action(previous, formData))
            if (result.href && !result.error) navigation.push(result.href)
            return result
        } catch {
            return { error: "The archive could not be confirmed. Refresh this relationship before trying again." }
        }
    }, {})
    const searchParams = useSearchParams()
    const tabId = searchParams.get(WORKSPACE_TAB_FRAME_PARAM)

    return (
        <form
            action={formAction}
            data-global-loading="false"
            data-workspace-mutation="background"
            onSubmit={(event) => {
                const confirmed = window.confirm(
                    `Archive ${relationshipName}? It will leave active lists and will no longer claim WhatsApp confirmations. Its history will be preserved.`,
                )
                if (!confirmed) event.preventDefault()
            }}
        >
            {tabId ? <input type="hidden" name={WORKSPACE_TAB_FRAME_PARAM} value={tabId} /> : null}
            {state.error ? <p className="mb-2 max-w-sm text-xs leading-5 text-red-300" aria-live="polite">{state.error}</p> : null}
            <DetailDangerButton
                type="submit"
                disabled={pending}
                className="disabled:cursor-wait"
            >
                {pending ? "Archiving…" : "Archive relationship"}
            </DetailDangerButton>
        </form>
    )
}
