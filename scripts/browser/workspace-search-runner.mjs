import React, { useState } from "react"
import { createRoot } from "react-dom/client"
import { flushSync } from "react-dom"
import { useWorkspaceSearch } from "@/components/workspace/useWorkspaceSearch"
import { WorkspaceSearchResults } from "@/components/workspace/WorkspaceSearchResults"
import { createWorkspaceSearchController } from "@/lib/workspace-search"
import { searchHandlers } from "./keyboard.js"

const h = React.createElement, cases = [], mobile = innerWidth < 768
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
const assert = (condition, message) => { if (!condition) throw Error(message) }
async function until(condition, message) {
    const end = performance.now() + 2500
    while (!condition() && performance.now() < end) await wait(5)
    assert(condition(), message)
}
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
const base = { scope: "user-a:workspace-a:staff", userId: "user-a", workspaceId: "workspace-a", workspaceSlug: "alpha", query: "", open: true }
const item = (label, slug = "alpha") => ({ id: label, type: "Relationship", label, description: "Synthetic search result", href: `/${slug}/work/${label}` })
const payload = (results, input = base) => ({ results, scope: { userId: input.userId, workspaceId: input.workspaceId } })
let requests = [], current, setInput, search, keyboard, navigations = [], generation = 0
window.fetch = (url, options) => {
    const pending = deferred()
    requests.push({ url, options, ...pending })
    // Deliberately ignore abort: late fetch/body completion must still be rejected by identity.
    return pending.promise
}
function Host() {
    const [input, update] = useState(base)
    current = input; setInput = update; search = useWorkspaceSearch(input)
    keyboard = searchHandlers({ search, searchOpen: input.open, desktopSearchInputRef: { get current() { return document.querySelector("#search") } }, mobileSearchTriggerRef: { get current() { return document.querySelector("#mobile-search-trigger") } }, setSearchOpen: open => update(previous => ({ ...previous, open })), navigateSearchDestination: href => navigations.push(href) })
    return h(React.Fragment, null,
        h("button", { id: "mobile-search-trigger", onClick: () => update(previous => ({ ...previous, open: true })) }, "Search"),
        h("textarea", { id: "sibling-draft", defaultValue: "Unsaved neighbouring tab draft", "aria-label": "Unrelated draft" }),
        h("input", { id: "search", value: input.query, role: "combobox", "aria-label": "Search Betelgeze", "aria-expanded": input.open, "aria-controls": "search-results", "aria-activedescendant": input.open && search.state.status === "results" ? `search-results-${search.state.selectedIndex}` : undefined, onChange: event => update(previous => ({ ...previous, query: event.target.value, open: true })), onKeyDown: keyboard.submitSearch, onFocus: () => update(previous => ({ ...previous, open: true })), className: "my-3 block h-11 w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3" }),
        input.open && h("section", { className: "max-h-80 overflow-y-auto rounded-xl border border-neutral-800", "data-search-popup": "" }, h(WorkspaceSearchResults, { id: "search-results", state: search.state, mobile, onChoose: keyboard.chooseSearchResult, onRetry: search.retry, isStandalone: href => href.includes("onboarding-builder") })))
}
const root = createRoot(document.querySelector("#stage"))
flushSync(() => root.render(h(Host)))
const update = values => flushSync(() => setInput(previous => ({ ...previous, ...values })))
const state = () => search.state
const options = () => [...document.querySelectorAll('[role="option"]')]
const key = (value, extras = {}) => { const event = new KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true, ...extras }); document.querySelector("#search").dispatchEvent(event); keyboard.escape(event) }
async function request(query) {
    const before = requests.length
    update({ query, open: true })
    await until(() => requests.length === before + 1, `Request did not start: ${query}`)
    return requests.at(-1)
}
function respond(request, results = [], input = current, status = 200) {
    request.resolve({ ok: status >= 200 && status < 300, status, json: async () => payload(results, input) })
}
async function reset() {
    requests = []; navigations = []
    flushSync(() => root.render(h(Host, { key: ++generation }))); await wait(0)
}
async function check(name, run) {
    try { await reset(); await run(); cases.push({ name, passed: true }) }
    catch (error) { cases.push({ name, passed: false, error: String(error) }) }
}

await check("one-character search remains idle without a request", async () => {
    update({ query: "a" }); await wait(210)
    assert(state().status === "idle" && requests.length === 0, "Short query fetched")
})
await check("rapid typing sends only the final debounced query", async () => {
    update({ query: "alpha" }); await wait(35); update({ query: "beta" }); await wait(35); update({ query: "gamma" })
    assert(state().status === "loading", "Debounce incorrectly looks empty")
    await until(() => requests.length === 1, "Final request missing")
    assert(requests[0].url.endsWith("q=gamma"), "Superseded query dispatched")
    assert(requests[0].options.cache === "no-store", "Search response may be cached")
    respond(requests[0], [item("gamma")]); await until(() => options().length === 1, "Result did not render")
})
await check("query changes immediately hide old results and block Enter", async () => {
    respond(await request("alpha"), [item("alpha")]); await until(() => options().length === 1, "Initial result missing")
    update({ query: "beta" }); key("Enter")
    assert(options().length === 0 && navigations.length === 0 && state().status === "loading", "Previous result remained selectable")
})
await check("late aborted request cannot clear the new loading state", async () => {
    const old = await request("alpha"), newer = await request("beta")
    assert(old.options.signal.aborted, "Previous request was not aborted")
    old.reject(new DOMException("Aborted", "AbortError")); await wait(0)
    assert(state().status === "loading", "Old finally cleared current loading")
    respond(newer, [item("beta")]); await until(() => options().some(node => node.textContent.includes("beta")), "Current result missing")
})
await check("late parsed body cannot replace newer results", async () => {
    const old = await request("alpha"), body = deferred()
    old.resolve({ ok: true, status: 200, json: () => body.promise }); await wait(0)
    const newer = await request("beta"); respond(newer, [item("beta")]); await until(() => state().status === "results", "New response missing")
    body.resolve(payload([item("alpha")])); await wait(0)
    assert(state().results[0]?.id === "beta", "Old body replaced new result")
})
await check("A to B to A uses request generation as well as query identity", async () => {
    const first = await request("alpha"), middle = await request("beta"), latest = await request("alpha")
    respond(first, [item("old-alpha")]); respond(middle, [item("beta")]); await wait(0)
    assert(state().status === "loading", "Earlier matching query became current")
    respond(latest, [item("new-alpha")]); await until(() => state().status === "results", "Latest response missing")
    assert(state().results[0].id === "new-alpha", "Wrong A generation selected")
})
await check("workspace change hides old results and rejects late old scope", async () => {
    const old = await request("alpha")
    update({ scope: "user-a:workspace-b:staff", workspaceId: "workspace-b", workspaceSlug: "beta" })
    respond(old, [item("old")], base); await wait(0)
    assert(options().length === 0 && state().status === "loading", "Old workspace was visible")
    await until(() => requests.length === 2, "New workspace did not request")
    respond(requests[1], [item("fresh", "beta")]); await until(() => state().status === "results", "New workspace result missing")
})
await check("account change masks settled results before its effect runs", async () => {
    respond(await request("alpha"), [item("old")]); await until(() => options().length === 1, "Initial result missing")
    update({ scope: "user-b:workspace-a:staff", userId: "user-b" }); key("Enter")
    assert(options().length === 0 && navigations.length === 0, "Other account result remained selectable")
})
await check("closing cancels and reopening requests fresh authorized results", async () => {
    const old = await request("alpha"); update({ open: false }); respond(old, [item("old")]); await wait(0)
    assert(old.options.signal.aborted && options().length === 0, "Closed search retained visible work")
    update({ open: true }); await until(() => requests.length === 2, "Reopen did not refresh")
    respond(requests[1], [item("fresh")]); await until(() => state().status === "results", "Fresh reopen missing")
    assert(state().results[0].id === "fresh", "Reopen reused stale result")
})
await check("HTTP failure stays distinct from no results and retries once", async () => {
    respond(await request("alpha"), [], current, 503); await until(() => state().status === "error", "Error state missing")
    assert(!document.querySelector('[data-search-popup]').textContent.includes("No results found"), "Failure mislabeled empty")
    document.querySelector('[data-search-popup] button').click()
    await until(() => requests.length === 2, "Retry did not request")
    respond(requests[1], [item("recovered")]); await until(() => state().status === "results", "Retry did not recover")
    assert(requests.length === 2, "Retry duplicated requests")
})
await check("successful empty response alone displays no results", async () => {
    respond(await request("missing")); await until(() => state().status === "empty", "Empty response missing")
    assert(document.querySelector('[role="status"]').textContent === "No results found.", "Incorrect empty message")
})
await check("malformed or unsafe result payload cannot produce navigation", async () => {
    respond(await request("alpha"), [{ ...item("bad"), href: "https://external.invalid/secret" }]); await until(() => state().status === "error", "Unsafe href accepted")
    key("Enter"); assert(navigations.length === 0 && options().length === 0, "Invalid payload was navigable")
})
await check("scope mismatch blocks retry until workspace session reload", async () => {
    respond(await request("alpha"), [item("wrong-user")], { ...base, userId: "other" }); await until(() => state().status === "error", "Scope mismatch accepted")
    search.retry(); update({ query: "beta" }); await wait(210)
    assert(requests.length === 1 && options().length === 0, "Blocked account silently retried")
    assert(!document.querySelector('[data-search-popup] button'), "Session error incorrectly offers retry")
})
await check("authorization expiry clears results and prohibits direct Enter fallback", async () => {
    respond(await request("new relationship"), [], current, 401); await until(() => state().status === "error", "Expired auth not visible")
    key("Enter"); assert(navigations.length === 0 && options().length === 0, "Unauthorized direct shortcut navigated")
})
await check("network error preserves an unrelated unsaved draft", async () => {
    const draft = document.querySelector("#sibling-draft"); draft.value = "Still unsaved during failed search"
    ;(await request("alpha")).reject(new TypeError("Network unavailable")); await until(() => state().status === "error", "Network failure not visible")
    assert(document.querySelector("#sibling-draft") === draft && draft.value === "Still unsaved during failed search", "Search reset unrelated state")
})
await check("archive labels and match reasons preserve listbox selection and navigation", async () => {
    const active = { ...item("Bruce Laing"), id: "active-bruce", href: "/alpha/relationships/36c6", recordId: "36c6", archived: false, matchReason: "Matched in name" }
    const archived = { ...active, id: "archived-bruce", href: "/alpha/relationships/e037", recordId: "e037", archived: true }
    respond(await request("bruce"), [active, archived]); await until(() => options().length === 2, "Bruce results missing")
    assert(!options()[0].textContent.includes("Archived") && options()[1].textContent.includes("Archived"), "Archive state missing or applied to active record")
    assert(options().every(option => option.textContent.includes("Matched in name") && option.textContent.includes("Relationship")), "Match reason or type label missing")
    assert(options()[0].textContent.includes("36c6") && options()[1].textContent.includes("e037"), "Distinct record references missing")
    key("End"); await until(() => state().selectedIndex === 1, "Archived result not keyboard-selectable")
    assert(options()[1].getAttribute("aria-selected") === "true", "Archived selection not exposed")
    key("Enter"); assert(navigations[0] === archived.href, "Archived result lost its destination")
})
await check("arrow selection and Enter navigate the selected current result", async () => {
    respond(await request("alpha"), [item("first"), item("second")]); await until(() => options().length === 2, "Results missing")
    key("ArrowDown"); await until(() => state().selectedIndex === 1, "Arrow selection missing")
    assert(options()[1].getAttribute("aria-selected") === "true", "Selected option not exposed")
    key("Enter"); assert(navigations[0] === "/alpha/work/second", "Enter selected wrong result")
})
await check("IME composition Enter cannot activate search", async () => {
    respond(await request("alpha"), [item("first")]); await until(() => options().length === 1, "Result missing")
    key("Enter", { isComposing: true }); assert(navigations.length === 0, "Composition Enter navigated")
})
await check("click selection uses current result and shell callback", async () => {
    respond(await request("alpha"), [item("clicked")]); await until(() => options().length === 1, "Result missing")
    options()[0].click(); assert(navigations[0] === "/alpha/work/clicked", "Result click bypassed selection")
})
await check("long search is rejected locally without a request", async () => {
    update({ query: "x".repeat(201) }); await wait(210)
    assert(state().status === "error" && requests.length === 0, "Long query dispatched")
})
await check("access invalidation removes all selectable results", async () => {
    respond(await request("alpha"), [item("old")]); await until(() => state().status === "results", "Result missing")
    flushSync(() => search.invalidate()); key("Enter")
    assert(state().status === "error" && options().length === 0 && navigations.length === 0, "Invalidated result stayed active")
})
await check("deadline includes response body parsing and settles exactly once", async () => {
    const body = deferred(), controller = createWorkspaceSearchController({ debounceMs: 0, deadlineMs: 25, fetch: async () => ({ ok: true, status: 200, json: () => body.promise }) })
    const input = { ...base, query: "alpha" }; controller.update(input)
    await until(() => controller.getSnapshot().status === "error", "Body timeout never settled")
    assert(controller.getSnapshot().error.includes("too long"), "Deadline message missing")
    body.resolve(payload([item("late")])); await wait(0)
    assert(controller.getSnapshot().status === "error" && controller.selected(input) === null, "Late body defeated timeout")
    controller.dispose()
})
await check("disposed controller rejects late completion", async () => {
    const pending = deferred(), controller = createWorkspaceSearchController({ debounceMs: 0, deadlineMs: 1000, fetch: () => pending.promise })
    controller.update({ ...base, query: "alpha" }); await wait(5); controller.dispose()
    pending.resolve({ ok: true, status: 200, json: async () => payload([item("late")]) }); await wait(0)
    assert(controller.getSnapshot().results.length === 0, "Disposed owner published late results")
})

await check("Escape from Retry restores search focus without reopening", async () => {
    respond(await request("alpha"), [], current, 503); await until(() => state().status === "error", "Error state missing")
    document.querySelector('[data-search-popup] button').focus(); key("Escape"); await wait(0)
    assert(!current.open && !document.querySelector('[data-search-popup]'), "Escape reopened search")
    assert(document.activeElement.id === (mobile ? "mobile-search-trigger" : "search"), "Escape restored the wrong focus")
})
await check("composition Escape leaves the search popup open", async () => {
    update({ query: "a" }); key("Escape", { isComposing: true }); await wait(0)
    assert(current.open, "IME cancellation closed search")
})

flushSync(() => root.unmount())
const report = { status: "complete", total: cases.length, passed: cases.filter(row => row.passed).length, cases, viewport: { width: innerWidth, height: innerHeight }, limits: "Actual production search modules and shell handlers with synthetic responses. No production account/data, real network latency, full-shell integration or physical-device evidence." }
window.workspaceSearchFixtureResult = report
document.querySelector("#result").textContent = JSON.stringify(report, null, 2)
