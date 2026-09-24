import React, { useLayoutEffect, useRef, useState } from "react"
import { createRoot } from "react-dom/client"
import Image from "next/image"
import { WORKSPACE_TAB_VISIBILITY_EVENT } from "@/lib/workspace-tabs"
import { TeamCommunicationsWorkspace } from "@/components/communications/TeamCommunicationsWorkspace"
import { CommunicationsWorkspace } from "@/components/communications/CommunicationsWorkspace"
import { WorkspaceNavigationProvider } from "@/components/workspace/WorkspaceNavigation"
import { Avatar } from "@/components/account/Avatar"
import { observeMobileWorkspaceViewport } from "@/lib/mobile-workspace-viewport"
import { MOBILE_CONVERSATION_VISIBILITY_EVENT, mobileConversationIsOpen } from "@/lib/mobile-conversation-viewport"
import { installPreviewLayoutTrace } from "./fullscreen-comms-preview-layout"
import { type DiagnosticState } from "./fullscreen-comms-diagnostic-schema"
import { teamBootstrap, clientBootstrap, installPreviewIO } from "./fullscreen-comms-preview-data"

installPreviewIO()

function Preview() {
    const root = useRef<HTMLDivElement>(null)
    const recorder = useRef<ReturnType<typeof installPreviewLayoutTrace> | null>(null)
    const [diagnosticState, setDiagnosticState] = useState<DiagnosticState>("ready")
    useLayoutEffect(() => {
        const capture = installPreviewLayoutTrace(setDiagnosticState)
        recorder.current = capture
        return () => { capture.dispose(); recorder.current = null }
    }, [])
    const [mode, setMode] = useState<"team" | "clients">("team")
    const [width, setWidth] = useState(320)
    const [tab, setTab] = useState("comms")
    const [sidebar, setSidebar] = useState(false)
    const [seenClients, setSeenClients] = useState(false)
    const [selection, setSelection] = useState<string | null>(null)
    useLayoutEffect(() => { document.body.dataset.workspaceActiveTabId = tab === "comms" ? "preview-comms" : "preview-work"; window.dispatchEvent(new Event(WORKSPACE_TAB_VISIBILITY_EVENT)) }, [tab])
    useLayoutEffect(() => {
        const shell = root.current!
        const mobile = matchMedia("(max-width: 1023px)")
        const controller = observeMobileWorkspaceViewport({ view: window, root: shell, topbar: shell.querySelector("[data-workspace-topbar]")!, tabbar: shell.querySelector("[data-workspace-tabbar]")!, panel: shell.querySelector("[data-workspace-tab-panels]")!, active: () => mobile.matches && !mobileConversationIsOpen(window) })
        const update = () => { if (mobileConversationIsOpen(window)) controller.suspend(); else controller.resume() }
        update()
        window.addEventListener(MOBILE_CONVERSATION_VISIBILITY_EVENT, update)
        window.addEventListener("resize", update)
        window.visualViewport?.addEventListener("resize", update)
        window.visualViewport?.addEventListener("scroll", update)
        return () => { controller.dispose(); window.removeEventListener(MOBILE_CONVERSATION_VISIBILITY_EVENT, update); window.removeEventListener("resize", update); window.visualViewport?.removeEventListener("resize", update); window.visualViewport?.removeEventListener("scroll", update) }
    }, [])
    const openClients = () => { setSeenClients(true); setMode("clients") }
    const navigation = { tabId: "preview-comms", workspaceSlug: "local-preview", url: `/local-preview/communications?mode=${mode}`, active: tab === "comms", push() {}, replace() {}, refresh() {}, back() {}, forward() {}, prefetch() {}, context() {} }
    return <div ref={root} data-workspace-shell-root>
        <header data-workspace-topbar className="fixed left-0 top-0 z-[55] h-14 w-full border-b border-neutral-800 bg-neutral-950/95 text-white shadow-lg shadow-black/20 backdrop-blur">
            <div className="grid h-full grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-3 sm:px-6">
                <div className="flex min-w-0 items-center gap-2.5"><Image unoptimized src="/brand/betelgeze-logo.svg" alt="" width={32} height={32} className="h-8 w-8 object-contain" /><p className="min-w-0 truncate text-sm font-semibold text-neutral-100">Betelgeze</p><button type="button" aria-label="Toggle sidebar" onClick={() => setSidebar(!sidebar)} className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-neutral-400"><svg viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current" strokeWidth="1.5"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16" /></svg></button></div>
                <div className="flex items-center gap-3"><button type="button" disabled={diagnosticState === "saving"} className="text-xs text-neutral-300" onClick={() => {
                    if (diagnosticState === "recording") recorder.current?.stop()
                    else if (diagnosticState === "error") recorder.current?.retry()
                    else recorder.current?.start()
                }}>{diagnosticState === "recording" ? "Stop & save" : diagnosticState === "saving" ? "Saving log…" : diagnosticState === "error" ? "Retry saving log" : diagnosticState === "saved" ? "Saved · Record again" : "Local v7 · Record test"}</button><Avatar src={null} name="You" className="h-9 w-9" /></div>
            </div>
        </header>
        <div data-workspace-tabbar className="fixed left-0 top-14 z-40 h-11 w-full border-b border-neutral-800 bg-neutral-950/95 text-white shadow-lg shadow-black/10 backdrop-blur">
            <div role="tablist" aria-label="Workspace tabs" className="flex h-full min-w-0 items-end gap-1 overflow-x-auto px-2 pt-1">{["comms", "work"].map(id => <div key={id} className={`group flex h-9 min-w-32 max-w-56 shrink-0 items-center rounded-t-lg border px-2 text-sm ${tab === id ? "border-neutral-700 border-b-neutral-950 bg-neutral-950 text-white" : "border-transparent bg-neutral-900/55 text-neutral-400"}`}><button type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className="min-w-0 flex-1 truncate text-left">{id === "comms" ? "Comms" : "Work"}</button></div>)}</div>
        </div>
        <main data-workspace-tab-panels className="fixed left-0 top-[6.25rem] h-[calc(100dvh-6.25rem)] w-full overflow-hidden bg-black">
            <section data-workspace-tab-id="preview-comms" data-workspace-tab-active={tab === "comms" ? "true" : "false"} className={tab === "comms" ? "h-full min-h-0" : "hidden"}>
                <WorkspaceNavigationProvider value={navigation}>
                    <div className={mode === "team" ? "h-full min-h-0" : "hidden"}><TeamCommunicationsWorkspace active={tab === "comms" && mode === "team"} bootstrap={teamBootstrap} onOpenClients={openClients} onSelectedConversationChange={setSelection} conversationListWidth={width} onConversationListWidthChange={setWidth} /></div>
                    {seenClients ? <div className={mode === "clients" ? "h-full min-h-0" : "hidden"}><CommunicationsWorkspace active={tab === "comms" && mode === "clients"} bootstrap={clientBootstrap} onOpenTeam={() => setMode("team")} onSelectedConversationChange={setSelection} conversationListWidth={width} onConversationListWidthChange={setWidth} /></div> : null}
                </WorkspaceNavigationProvider>
            </section>
            {tab === "work" ? <section className="p-6"><h1 className="text-xl font-semibold">Work</h1><p className="mt-3 text-sm text-neutral-500">This local preview focuses on Comms. Return to the Comms tab to continue.</p></section> : null}
            {sidebar ? <aside className="absolute inset-y-0 left-0 z-50 w-64 border-r border-neutral-800 bg-neutral-950 p-4"><button type="button" className="mb-4 text-sm text-neutral-400" onClick={() => setSidebar(false)}>Close sidebar</button><button type="button" className="block w-full rounded-lg bg-neutral-800 p-3 text-left text-sm" onClick={() => { setTab("comms"); setSidebar(false) }}>Communications</button><p className="mt-6 text-xs leading-5 text-neutral-500">Synthetic conversations only. Messages and attachments stay in this browser. No account or provider is connected.</p></aside> : null}
        </main>
        <output id="preview-state" hidden>{JSON.stringify({ mode, tab, selection })}</output>
    </div>
}

createRoot(document.getElementById("preview-root")!).render(<Preview />)
