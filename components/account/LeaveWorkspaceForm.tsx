"use client"

type Props = { action: (formData: FormData) => void; workspaceId: string }

export function LeaveWorkspaceForm({ action, workspaceId }: Props) {
    return <form action={action} onSubmit={(event) => { if (!window.confirm("Leave this workspace? You will lose access immediately.")) event.preventDefault() }}><input type="hidden" name="workspaceId" value={workspaceId} /><button className="rounded-lg border border-red-900 px-3 py-2 text-sm text-red-300">Leave workspace</button></form>
}
