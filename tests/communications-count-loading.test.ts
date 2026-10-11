import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire, Module } from "node:module"
import { resolve } from "node:path"
import test from "node:test"
import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import ts from "typescript"

function compile(path: string, dependencies: Record<string, unknown> = {}) {
    const absolute = resolve(path)
    const localRequire = createRequire(absolute)
    const compiled = new Module(absolute) as Module & { _compile: (source: string, filename: string) => void }
    compiled.require = ((name: string) => name in dependencies ? dependencies[name] : localRequire(name)) as typeof compiled.require
    compiled._compile(ts.transpileModule(readFileSync(path, "utf8"), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
    }).outputText, absolute)
    return compiled.exports
}
const { UnreadMessageCount } = compile("components/communications/UnreadMessageCount.tsx")
const renderCount = (count?: number, loading = false) => renderToStaticMarkup(React.createElement(UnreadMessageCount, { count, loading, label: "unread messages" }))

test("unknown count has a readable loading state, confirmed zero is hidden and positive counts are capped", () => {
    assert.match(renderCount(undefined, true), /aria-label="Loading unread messages"/)
    assert.match(renderCount(0, true), />…<\/span>/)
    assert.equal(renderCount(0), "")
    assert.equal(renderCount(undefined), "", "legacy optional counts stay hidden")
    assert.match(renderCount(3), /aria-label="3 unread messages"/)
    assert.match(renderCount(101), /aria-label="99\+ unread messages"/)
})

type Snapshot = { loaded?: boolean; stale: boolean; deviceId?: string | null; rows: Array<{ kind: "client" | "native"; count: number }> } | null
function renderModes(readProtocol: "device-v1" | "account-v1", snapshot: Snapshot) {
    const { CommunicationsPanel } = compile("components/communications/CommunicationsPanel.tsx", {
        react: { ...React, lazy: () => (props: { teamUnreadCount?: number; clientUnreadCount?: number; onOpenTeam?: unknown }) => {
            const client = Boolean(props.onOpenTeam)
            const count = client ? props.teamUnreadCount : props.clientUnreadCount
            return React.createElement(UnreadMessageCount, { count, loading: readProtocol === "device-v1" && count === undefined, label: client ? "unread Team messages" : "unread Client messages" })
        } },
        "@/components/workspace/PanelRouteLoading": { PanelRouteLoading: () => null },
        "./CommunicationsReadProtocol": { CommunicationsReadProtocolContext: React.createContext(null), useCommunicationsReadProtocol: () => readProtocol },
        "./useCommunicationsUnread": { useCommunicationsUnread: () => ({}) },
        "./useSharedUnreadSummary": { useSharedUnreadSummary: (_workspaceId: string, _userId: string, fallback: string) => { assert.equal(fallback, readProtocol); return snapshot } },
        "@/lib/communications/unread-broadcast": { invalidateUnreadSummary: () => {} },
        "@/components/ui": { Status: () => null },
        "@/lib/communications/mode-resource": { createCommunicationsModeResource: () => { throw Error("SSR cannot create another summary owner") } },
        "@/components/communications/ResizableConversationColumns": { DEFAULT_CONVERSATION_LIST_WIDTH: 320 },
        "@/lib/workspace-tabs": {},
        "@/components/workspace/WorkspaceNavigation": { useWorkspaceNavigation: () => ({ active: true }) },
        "@/lib/workspace-navigation-lifecycle": {},
    })
    const bootstrap = { workspaceId: "workspace", workspaceSlug: "demo", currentUser: { id: "viewer" }, readProtocol }
    return renderToStaticMarkup(React.createElement(CommunicationsPanel, { readProtocol, clientBootstrap: bootstrap, nativeBootstrap: bootstrap, initialMode: "clients" }))
}

test("device mode badges stay unknown until the shared server summary arrives, independent of child bootstrap", () => {
    for (const snapshot of [null, { loaded: false, stale: true, rows: [] }]) {
        const html = renderModes("device-v1", snapshot)
        assert.match(html, /Loading unread Client messages/)
        assert.match(html, /Loading unread Team messages/)
    }
    const html = renderModes("device-v1", { loaded: true, stale: false, deviceId: "installation", rows: [{ kind: "client", count: 2 }, { kind: "native", count: 3 }] })
    assert.match(html, /2 unread Client messages/)
    assert.match(html, /3 unread Team messages/)
    assert.doesNotMatch(html, /Loading unread/)
})

test("device identity recovery retains confirmed mode counts and account mode keeps its old callback counts", () => {
    const stale = { loaded: true, stale: true, deviceId: null, rows: [{ kind: "client" as const, count: 2 }] }
    const html = renderModes("device-v1", stale)
    assert.match(html, /2 unread Client messages/)
    assert.doesNotMatch(html, /Loading unread|unread Team messages/)
    assert.doesNotMatch(renderModes("device-v1", { loaded: true, stale: false, rows: [] }), /unread (Client|Team) messages/)
    assert.doesNotMatch(renderModes("account-v1", stale), /Loading unread|unread (Client|Team) messages/)
})
