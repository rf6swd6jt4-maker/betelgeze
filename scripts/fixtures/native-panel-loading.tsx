// Synthetic data, real native tab/cache/chrome lifecycle; no account or provider I/O.
import React, { useCallback, useState } from "react"
import { createRoot } from "react-dom/client"
import { NativeWorkspaceTab, type NativePanelSnapshot, type NativeTabHandle } from "@/components/workspace/NativeWorkspaceTab"
import { WorkspaceRecordCache } from "@/lib/workspace-record-cache"
import { WorkspaceTabScrollStore } from "@/lib/workspace-tab-scroll"
import { WorkspaceBannerPending } from "@/components/admin/WorkspaceBannerPending"

const cache = new WorkspaceRecordCache<NativePanelSnapshot>()
const scrollPositions = new WorkspaceTabScrollStore()
const messages: Array<{ type: string; url?: string }> = []
const requests: Array<{ url: string; settle: (status: number) => void }> = []
const pending: typeof requests = []
let handle: NativeTabHandle | null = null

window.fetch = (input) => new Promise<Response>((resolve) => {
    const url = String(input)
    const request = { url, settle(status: number) {
        const query = new URL(url, location.origin).searchParams
        const kind = query.get("kind") ?? "relationships"
        resolve(new Response(JSON.stringify({ kind, userId: "user", workspaceId: "workspace", workspaceSlug: "fixture", context: null }), { status, headers: { "content-type": "application/json" } }))
    } }
    requests.push(request)
    pending.push(request)
})

function Fixture() {
    const [url, setUrl] = useState("/fixture/work-items")
    const [active, setActive] = useState(true)
    const assignRef = useCallback((_id: string, value: NativeTabHandle | null) => { handle = value }, [])
    const onMessage = useCallback((message: { type: string; url?: string }) => { messages.push(message) }, [])
    Object.assign(window, { nativeLoadingFixture: {
        requests, messages, pending: () => pending.length,
        settle(status = 200) { const current = pending.splice(0); for (const request of current) request.settle(status) },
        refresh() { handle?.post({ type: "activate", active: true, refresh: true }) },
        navigate: setUrl, active: setActive,
    } })
    return <><header className="h-24 border-b border-neutral-800 bg-neutral-950 px-4 text-white">Synthetic shell and tab bar</header>
        <div data-fixture-panel className="relative h-[calc(100dvh-6rem)] bg-neutral-950">
            <NativeWorkspaceTab tab={{ id: "tab", title: "Synthetic panel", url }} active={active} contextOpen={false}
                workspaceId="workspace" workspaceSlug="fixture" userId="user" cache={cache} accountCleared={false}
                scrollPositions={scrollPositions} assignRef={assignRef} onMessage={onMessage} prepareNavigation={() => null}
                banner={<WorkspaceBannerPending />} />
        </div>
    </>
}
createRoot(document.getElementById("root")!).render(<Fixture />)
