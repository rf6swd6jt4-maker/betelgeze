import React, { StrictMode, useEffect, useLayoutEffect, useState } from "react"
import { createRoot } from "react-dom/client"
import { flushSync } from "react-dom"
import { NativeCommunicationsTab } from "./NativeCommunicationsTab.js"
import { WorkspaceRecordCache } from "./workspace-record-cache.js"
import { CommunicationsRuntime, useCommunicationsClient } from "./CommunicationsRuntime.js"
import { authState, shared, transports } from "./supabase-fixture.js"

const h = React.createElement
const runtimeOnly = new URL(location.href).searchParams.has("runtime")
const delay = ms => new Promise(done => setTimeout(done, ms))
const assert = (value, message) => { if (!value) throw Error(message) }
async function until(condition) { for (let i = 0; i < 200; i++) { if (condition()) return; await delay(10) } throw Error("Condition timed out") }
window.fixtureInstance = 0
window.fixtureWorkspaces = {}
const events = [], requests = [], handles = new Map(), cache = new WorkspaceRecordCache()
const originalFetch = window.fetch.bind(window)
window.fetch = (...args) => { requests.push(String(args[0])); return originalFetch(...args) }
let state, setTabs, activate
const assignRef = (id, handle) => { if (handle) handles.set(id, handle); else handles.delete(id) }
const onMessage = message => events.push(message)
const prepareNavigation = request => guard => {
    if (!guard() || state.active !== request.tabId || state.tabs.find(tab => tab.id === request.tabId)?.url !== request.sourceUrl) return false
    flushSync(() => setTabs(tabs => tabs.map(tab => tab.id === request.tabId ? { ...tab, url: request.url } : tab)))
    return true
}
function App() {
    const [tabs, updateTabs] = useState([{ id: "a", url: "/demo/communications?conversation=initial-a" }, { id: "b", url: "/demo/communications?conversation=initial-b" }])
    const [active, updateActive] = useState("a")
    useLayoutEffect(() => { state = { tabs, active }; setTabs = updateTabs; activate = updateActive; document.body.dataset.workspaceActiveTabId = active }, [tabs, active])
    return tabs.map(tab => h(NativeCommunicationsTab, { key: tab.id, tab, active: active === tab.id, workspaceId: "workspace", workspaceSlug: "demo", userId: "viewer", cache, accountCleared: false, assignRef, onMessage, prepareNavigation }))
}
const root = createRoot(document.querySelector("#host"))
if (!runtimeOnly) flushSync(() => root.render(h(App)))
const cases = []
async function check(name, run) { try { await run(); cases.push({ name, passed: true }) } catch (error) { cases.push({ name, passed: false, error: String(error) }); throw error } }
const ready = id => events.some(event => event.tabId === id && event.type === "meaningful-ready")
const panel = id => document.querySelector(`[data-mobile-comms-tab="${id}"]`)
try {
    if (runtimeOnly) {
        const captured = new Map(), effects = { setup: 0, cleanup: 0 }
        function Consumer({ id }) {
            const client = useCommunicationsClient()
            useLayoutEffect(() => { captured.set(id, client) }, [id, client])
            useEffect(() => {
                effects.setup++
                const channel = client.channel(`synthetic:${id}`).subscribe()
                return () => { effects.cleanup++; void client.removeChannel(channel) }
            }, [id, client])
            return null
        }
        flushSync(() => root.render(h(StrictMode, null,
            h(CommunicationsRuntime, null, h(Consumer, { id: "a:clients" }), h(Consumer, { id: "a:team" })),
            h(CommunicationsRuntime, null, h(Consumer, { id: "b:clients" })),
        )))
        await delay(30)
        const a = captured.get("a:clients"), team = captured.get("a:team"), b = captured.get("b:clients")
        const aTransport = transports.find(transport => transport.realtime === a?.realtime)
        const bTransport = transports.find(transport => transport.realtime === b?.realtime)
        await check("two modes in one tab share a correctly bound transport", async () => {
            assert(a && a === team && aTransport, "Same-tab consumers received different clients")
            assert(aTransport.channels.length === 2 && aTransport.channels.every(channel => channel.owner === aTransport.id), "Transport channel methods lost their owner binding")
        })
        await check("resident tabs isolate channels while sharing singleton auth and fresh tokens", async () => {
            assert(b && bTransport && aTransport !== bTransport && a.realtime !== b.realtime, "Different tabs shared a realtime transport")
            assert(a.auth === shared.auth && b.auth === shared.auth && authState.factoryCalls >= 2, "Tab provider constructed separate auth ownership")
            assert(bTransport.channels.length === 1, "Tab channels leaked into another transport")
            assert(await aTransport.options.accessToken() === "fixture-token", "Initial singleton token was not used")
            authState.token = "rotated-fixture-token"
            assert(await bTransport.options.accessToken() === "rotated-fixture-token", "Token callback captured a stale session")
        })
        await check("witnessed StrictMode effect replay keeps retained transports alive", async () => {
            assert(effects.setup === 6 && effects.cleanup === 3, "Development StrictMode effect replay did not execute")
            assert(aTransport.removedAll === 0 && bTransport.removedAll === 0, "Replay destroyed a retained transport")
            assert(aTransport.channels.length === 2 && bTransport.channels.length === 1, "Replay lost live channels")
        })
        await check("real provider departure disposes each owned transport exactly once", async () => {
            flushSync(() => root.unmount())
            await delay(0)
            assert(aTransport.removedAll === 1 && bTransport.removedAll === 1, "Real departure failed to dispose its transport")
            assert(aTransport.channels.length === 0 && bTransport.channels.length === 0, "Channels survived real departure")
            await delay(0)
            assert(aTransport.removedAll === 1 && bTransport.removedAll === 1, "Disposal ran more than once")
            assert(requests.length === 0, "Runtime boundary test made a network request")
        })
    } else {
    await check("initial host paints active chat without iframe or hidden-tab bootstrap", async () => {
        await until(() => ready("a") && state.tabs[0].url.includes("mode=clients"))
        await delay(80)
        assert(document.querySelectorAll("iframe").length === 0, "Comms mounted an iframe")
        assert(!requests.some(url => url.includes("conversation=initial-b")), "Hidden tab eagerly bootstrapped")
        assert(!ready("b"), "Hidden tab reported ready")
    })
    let token, input
    await check("local conversation selection updates its route without remount or bootstrap", async () => {
        token = window.fixtureWorkspaces["a:clients"].token
        input = panel("a").querySelector("input")
        const count = requests.length
        flushSync(() => window.fixtureWorkspaces["a:clients"].select("local-choice"))
        await until(() => state.tabs[0].url.includes("conversation=local-choice"))
        assert(window.fixtureWorkspaces["a:clients"].token === token && panel("a").querySelector("input") === input, "Local selection remounted editor")
        assert(requests.length === count, "Local selection repeated bootstrap")
    })
    await check("hidden native tab cannot replace active route or steal focus", async () => {
        input.focus()
        flushSync(() => activate("b"))
        await until(() => ready("b"))
        assert(document.activeElement !== input && panel("a").hidden && panel("a").inert, "Outgoing tab retained interaction")
        const before = state.tabs.map(tab => tab.url).join("|")
        window.fixtureWorkspaces["a:clients"].navigate("/demo/communications?conversation=forbidden-hidden")
        await delay(40)
        assert(state.tabs.map(tab => tab.url).join("|") === before, "Hidden tab replaced location")
        flushSync(() => activate("a"))
        await delay(50)
        assert(panel("a").querySelector("input") === input && window.fixtureWorkspaces["a:clients"].token === token, "Resident return remounted editor")
    })
    await check("workspace links use the shell instead of navigating the document", async () => {
        const address = location.href
        const link = panel("a").querySelector("a")
        const start = events.length
        const click = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 })
        link.dispatchEvent(click)
        await delay(20)
        assert(click.defaultPrevented, "Workspace link was not intercepted")
        assert(location.href === address, "Workspace link changed document address")
        assert(events.slice(start).some(event => event.type === "open-tab" && event.url === "/demo/relationships/synthetic"), "Workspace link did not reach shell")
    })
    await check("explicit delayed route never acknowledges preceding mounted content", async () => {
        const next = "/demo/communications?mode=clients&conversation=delayed-next"
        const start = events.length
        flushSync(() => setTabs(tabs => tabs.map(tab => tab.id === "a" ? { ...tab, url: next } : tab)))
        handles.get("a").post({ type: "probe" })
        await delay(80)
        assert(!events.slice(start).some(event => event.url === next && ["location", "meaningful-ready"].includes(event.type)), "New route was acknowledged before read/paint")
        await until(() => events.slice(start).some(event => event.url === next && event.type === "meaningful-ready"))
        assert(window.fixtureWorkspaces["a:clients"].token !== token, "Explicit destination reused wrong route session")
    })
    await check("obsolete delayed route cannot acknowledge or replace its successor", async () => {
        const stale = "/demo/communications?mode=clients&conversation=delayed-stale"
        const latest = "/demo/communications?mode=clients&conversation=successor"
        const start = events.length
        flushSync(() => setTabs(tabs => tabs.map(tab => tab.id === "a" ? { ...tab, url: stale } : tab)))
        await delay(30)
        flushSync(() => setTabs(tabs => tabs.map(tab => tab.id === "a" ? { ...tab, url: latest } : tab)))
        await until(() => events.slice(start).some(event => event.url === latest && event.type === "meaningful-ready"))
        await delay(380)
        assert(state.tabs[0].url === latest, "Late result overwrote successor")
        assert(!events.slice(start).some(event => event.url === stale && ["location", "meaningful-ready"].includes(event.type)), "Obsolete route reported paint")
    })
    }
} catch { /* Each named assertion is retained below. */ }
const result = { status: "complete", passed: cases.filter(value => value.passed).length, total: cases.length, cases, limits: "Actual resident host, panel, runtime, cache and navigation provider; child chats, bootstraps and Supabase/auth factories are synthetic. Runtime StrictMode tests use development React and no network. No authenticated UI, live socket, device, or production evidence." }
window.nativeCommsFixtureResult = result
document.querySelector("#result").textContent = JSON.stringify(result, null, 2)
