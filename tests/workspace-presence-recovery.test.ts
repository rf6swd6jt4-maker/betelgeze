import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import ts from "typescript"

const settle = async () => { for (let i = 0; i < 40; i++) await Promise.resolve() }
function mount() {
    const source = ts.createSourceFile("shell.tsx", readFileSync("components/workspace/WorkspaceTopBarClient.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    let effect: ts.Node | undefined
    const visit = (node: ts.Node) => {
        if (ts.isCallExpression(node) && node.expression.getText(source) === "useEffect" && node.arguments[0]?.getText(source).includes("if (!presenceSessionIdRef.current)")) effect = node.arguments[0]
        ts.forEachChild(node, visit)
    }
    visit(source); assert.ok(effect)
    const code = ts.transpileModule(`const effect = ${effect.getText(source)}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
    let timerId = 0, removes = 0, tracks = 0, summaries = 0, sessionReads = 0, token = "initial"
    const timers = new Map<number, () => void>(), applied: string[] = []
    let auth: (event: string, session: { access_token: string }) => void = () => {}
    const channels: Array<{ status: (value: string) => void }> = []
    const window = Object.assign(new EventTarget(), { setTimeout: (cb: () => void) => { timers.set(++timerId, cb); return timerId }, clearTimeout: (id: number) => timers.delete(id) })
    const document = Object.assign(new EventTarget(), { visibilityState: "visible" })
    const supabase = {
        auth: { getSession: async () => { sessionReads++; return { data: { session: { access_token: token } } } }, onAuthStateChange: (callback: typeof auth) => { auth = callback; return { data: { subscription: { unsubscribe() {} } } } } },
        realtime: { setAuth: async (value: string) => { applied.push(value) } },
        removeChannel: async () => { removes++ },
        channel: () => { const c = { status: (_value: string) => { void _value }, on() { return c }, subscribe(callback: (value: string) => void) { c.status = callback; return c }, track: async () => { tracks++ } }; channels.push(c); return c },
    }
    const state = { current: "connecting" }
    const noop = () => {}
    const dependencies = { window, document, createSupabaseBrowserClient: () => supabase, presenceSessionIdRef: { current: "fixture-session" }, presenceStateRef: state,
        setPresenceState: (value: string) => { state.current = value }, setPresenceError: noop, workspace: { id: "w", slug: "example" }, currentUserId: "u",
        fetch: async () => ({}), presenceIdentityRef: { current: { name: "Fixture", avatarSrc: null } }, tabsRef: { current: [] }, activeTabIdRef: { current: "tab" }, presenceChannelRef: { current: null },
        workspacePresenceTopic: () => "fixture", invalidateUnreadSummary: noop, unreadMessageEventKey: noop, normalizeChatReadUpdate: noop, publishChatRead: noop,
        refreshCommunicationsUnread: () => { summaries++ }, setActiveWorkspaceUsers: noop, visibleWorkspacePresence: noop, workspaceMembersRef: { current: [] },
    }
    const dispose = new Function(...Object.keys(dependencies), `${code}; return effect()`)(...Object.values(dependencies)) as () => void
    return { window, channels, state, applied, timers, dispose, fire: () => { const callbacks = [...timers.values()]; timers.clear(); callbacks.forEach(cb => cb()) }, auth: (value = token) => { token = value; auth("SIGNED_IN", { access_token: value }) }, counts: () => ({ removes, tracks, summaries, sessionReads }) }
}

test("workspace presence keeps pending and live joins across duplicate auth and focus, and applies renewed tokens in place", async () => {
    const app = mount()
    try {
        await settle()
        app.auth(); app.fire(); app.window.dispatchEvent(new Event("focus")); await settle()
        assert.equal(app.channels.length, 1); assert.equal(app.counts().removes, 0)
        app.channels[0].status("SUBSCRIBED"); await settle()
        const initial = app.counts()
        app.auth(); app.fire(); await settle()
        assert.deepEqual(app.counts(), initial)
        app.auth("renewed"); app.fire(); await settle()
        assert.equal(app.applied.at(-1), "renewed"); assert.equal(app.counts().removes, 0)
        assert.equal(app.channels.length, 1); assert.equal(app.counts().tracks, 1)
        app.channels[0].status("CHANNEL_ERROR"); app.fire(); await settle()
        assert.equal(app.channels.length, 2)
        app.channels[1].status("SUBSCRIBED"); await settle()
        assert.equal(app.state.current, "live"); assert.equal(app.counts().summaries, 2)
    } finally { app.dispose() }
})

test("SDK recovery cancels a scheduled presence restart; disposal fences queued auth", async () => {
    const app = mount()
    await settle()
    app.channels[0].status("CHANNEL_ERROR")
    assert.equal(app.timers.size, 1)
    app.channels[0].status("SUBSCRIBED"); await settle(); app.fire(); await settle()
    assert.equal(app.channels.length, 1); assert.equal(app.counts().removes, 0)
    app.auth("late"); app.dispose(); app.fire(); await settle()
    assert.equal(app.applied.at(-1), "initial")
})
