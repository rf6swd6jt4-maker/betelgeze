import React, { useEffect, useState } from "react"
import { createRoot } from "react-dom/client"
import { RelationshipQueue } from "@/components/relationships/RelationshipServiceTimeline"
import { WorkspaceNavigationProvider } from "@/components/workspace/WorkspaceNavigation"

type PendingRead = {
    url: string
    user: string | null
    signal: AbortSignal | null | undefined
    options: { cache?: RequestCache; credentials?: RequestCredentials; redirect?: RequestRedirect }
    settled: boolean
    resolve: (value: Response) => void
    reject: (reason: Error) => void
}
const requests: PendingRead[] = []
const fixture = {
    requests,
    active: (value: boolean) => { void value },
    account: (value: string) => { void value },
    destination: (value: string) => { void value },
    respond(index: number, status: number, data: unknown) {
        const request = requests[index]
        if (request.settled) throw Error("Fixture request already settled")
        request.settled = true
        request.resolve(new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } }))
    },
    reject(index: number) {
        requests[index].settled = true
        requests[index].reject(new TypeError("Network unavailable"))
    },
}
Object.assign(window, { relationshipQueueFixture: fixture })
// Deliberately allow aborted reads to settle: the component must reject late results.
window.fetch = (url, options = {}) => new Promise<Response>((resolve, reject) => {
    requests.push({ url: String(url), user: new Headers(options.headers).get("x-workspace-user"), signal: options.signal,
        options: { cache: options.cache, credentials: options.credentials, redirect: options.redirect }, settled: false, resolve, reject })
})
const unexpectedNavigation = () => { throw Error("Refreshing the queue must not navigate or refresh the surrounding workspace") }
function Fixture() {
    const [active, setActive] = useState(true)
    const [userId, setUserId] = useState("account-a")
    const [relationshipId, setRelationshipId] = useState("relationship-a")
    useEffect(() => {
        fixture.active = setActive
        fixture.account = setUserId
        fixture.destination = setRelationshipId
    }, [])
    return <WorkspaceNavigationProvider value={{ active, tabId: "queue-fixture", workspaceSlug: "fixture", url: "/fixture/relationships/relationship-a",
        push: unexpectedNavigation, replace: unexpectedNavigation, refresh: unexpectedNavigation, back: unexpectedNavigation,
        forward: unexpectedNavigation, prefetch: () => {}, context: () => {} }}>
        <main className="mx-auto max-w-3xl p-4 text-white">
            <label className="mb-4 block">Unrelated draft<input aria-label="Unrelated draft" className="ml-3 border border-neutral-700 bg-black" /></label>
            <div className="h-[32rem]">
                <RelationshipQueue endpoint={`/api/relationships/${relationshipId}/services`} relationshipId={relationshipId} slug="fixture" userId={userId} revision="fixture" />
            </div>
        </main>
    </WorkspaceNavigationProvider>
}
createRoot(document.getElementById("root")!).render(<Fixture />)
