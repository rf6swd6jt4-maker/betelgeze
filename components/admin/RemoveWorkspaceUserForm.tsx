"use client"

import { useActionState } from "react"
import { WorkspaceActionButton } from "@/components/workspace/WorkspaceActionButton"

type RemoveResult = { ok: boolean; message: string }

export function RemoveWorkspaceUserForm({ userId, email, action }: {
    userId: string
    email: string
    action: (previous: RemoveResult | null, formData: FormData) => Promise<RemoveResult>
}) {
    const [result, formAction] = useActionState(async (previous: RemoveResult | null, formData: FormData): Promise<RemoveResult> => {
        try {
            return await action(previous, formData)
        } catch {
            return { ok: false, message: "The removal could not be confirmed. Refresh the list to check before trying again." }
        }
    }, null)

    return <>
        <form action={formAction} data-workspace-mutation="background" className="flex-1 sm:flex-none">
            <input type="hidden" name="userId" value={userId} />
            <WorkspaceActionButton pendingLabel="Removing…" confirmMessage={`Remove ${email} from the workspace?`} className="w-full rounded-lg border border-red-900 px-3 py-1 text-sm text-red-300 sm:w-auto">Remove</WorkspaceActionButton>
        </form>
        {result && !result.ok ? <p role="alert" className="basis-full text-xs leading-5 text-red-300 sm:max-w-sm">{result.message}</p> : null}
    </>
}
