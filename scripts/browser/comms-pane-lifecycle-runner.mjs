import React, { StrictMode, useLayoutEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { MobileConversationSurface } from './MobileConversationSurface.js'
import { ChatMotionViewport } from './ChatMotionViewport.js'
import { useConversationLayout } from './useConversationLayout.js'
const h = React.createElement, wait = ms => new Promise(resolve => setTimeout(resolve, ms))
const assert = (condition, message) => { if (!condition) throw Error(message) }
const until = async (condition, label) => { for (let i = 0; i < 60; i++) { if (condition()) return; await wait(20) } throw Error(label) }
// Transparent fixture instrumentation: retain the real native observer and
// callbacks, but count live targets to catch duplicate owners or leaked cleanup.
const NativeResizeObserver = window.ResizeObserver
const resizeTargets = new Map()
window.ResizeObserver = class extends NativeResizeObserver {
    observe(target, options) {
        const targets = resizeTargets.get(this) ?? new Set()
        targets.add(target); resizeTargets.set(this, targets)
        super.observe(target, options)
    }
    unobserve(target) {
        const targets = resizeTargets.get(this); targets?.delete(target)
        if (!targets?.size) resizeTargets.delete(this)
        super.unobserve(target)
    }
    disconnect() { resizeTargets.delete(this); super.disconnect() }
}
const paneObserverCount = pane => [...resizeTargets.values()].filter(targets => targets.has(pane)).length
let root, api
const cases = []
function App({ initial }) {
    const [state, setState] = useState({ selected: 'a', loaded: true, active: true, count: 35, epoch: 0, footerHeight: 70, ...initial })
    const [atLatest, setAtLatest] = useState(true), [jump, setJump] = useState(false)
    const pane = useRef(null), follow = useRef(true)
    // The baseline returns void. A callback returned by the fixed hook binds
    // the actual portal commit, while the same fixture exercises both revisions.
    const attach = useConversationLayout(pane, follow, state.selected, state.active, setAtLatest, setJump)
    useLayoutEffect(() => { api = { setState, pane, follow, state, atLatest, jump } }, [state, atLatest, jump])
    const selected = state.selected && state.loaded
    return h('div', { style: { height: '100%', display: state.active ? 'block' : 'none' } },
        h(MobileConversationSurface, { selected: Boolean(selected), active: state.active, onClose: () => setState(value => ({ ...value, selected: null })) },
            h('section', { className: 'fixture-chat', 'data-native-chat-viewport': true }, selected ? [
                h('header', { key: 'header', 'data-fixture-header': true }, `Chat ${state.selected}`),
                h(ChatMotionViewport, { key: state.selected },
                    h('div', { className: 'relative min-h-0 flex-1' },
                        h('div', {
                            key: state.selected + ':' + state.epoch, ref: attach ?? pane,
                            'data-message-pane': true, 'data-empty': !state.count ? 'true' : undefined,
                            className: 'invisible data-[positioned=true]:visible h-full overflow-y-auto fixture-pane',
                            style: { overflowAnchor: 'none' },
                        }, h('div', { className: 'fixture-content' }, state.count ? Array.from({ length: state.count }, (_, index) =>
                            h('div', { key: index, 'data-message-scroll-anchor': String(index), 'data-message-interaction': String(index), className: 'fixture-row' }, `Message ${index}`)
                        ) : h('div', { 'data-conversation-empty': true }, 'Start a new conversation')))),
                    h('div', { 'data-composer-slot': true }, h('footer', { 'data-fixture-composer': true, style: { height: state.footerHeight } }, 'Composer'))),
            ] : h('p', null, 'Select a chat'))))
}
async function setup(initial = {}, strict = false) {
    root?.unmount(); api = null; await wait(30)
    assert(!document.querySelector('[data-mobile-conversation-surface]'), 'Previous portal survived unmount')
    assert(resizeTargets.size === 0, 'Previous chat leaked a resize observer')
    root = createRoot(document.getElementById('stage'))
    root.render(strict ? h(StrictMode, null, h(App, { initial })) : h(App, { initial }))
    await until(() => api, 'fixture did not mount')
}
function evidence() {
    const pane = api?.pane.current
    return { selected: api?.state.selected, pane: Boolean(pane), positioned: pane?.dataset.positioned ?? null,
        paneHeight: pane?.clientHeight ?? null, paneObservers: paneObserverCount(pane), liveObservers: resizeTargets.size, visibility: pane ? getComputedStyle(pane).visibility : null,
        scrollTop: pane?.scrollTop ?? null, scrollHeight: pane?.scrollHeight ?? null,
        headerVisible: Boolean(document.querySelector('[data-fixture-header]')?.getBoundingClientRect().height),
        composerVisible: Boolean(document.querySelector('[data-fixture-composer]')?.getBoundingClientRect().height),
        surfacePhase: document.querySelector('[data-mobile-conversation-surface]')?.dataset.phase ?? 'inline' }
}
async function positioned() {
    await until(() => api.pane.current?.dataset.positioned === 'true' && api.pane.current.clientHeight > 0, 'Pane stayed unpositioned/black')
    await wait(280)
    assert(getComputedStyle(api.pane.current).visibility === 'visible', 'Positioned messages remain hidden')
    assert(paneObserverCount(api.pane.current) === 1, 'Pane must have exactly one layout observer')
    assert(api.pane.current.scrollHeight - api.pane.current.clientHeight - api.pane.current.scrollTop <= 1, 'Initial newest row was not bottom anchored')
    assert(evidence().headerVisible && evidence().composerVisible, 'Header or composer disappeared')
}
async function warm(initial = {}, strict = false) {
    await setup({ ...initial, selected: null }, strict)
    await wait(60)
    api.setState(state => ({ ...state, selected: 'a' }))
    await positioned()
}
async function run(name, execute) {
    try { await execute(); cases.push({ name, passed: true, evidence: evidence() }) }
    catch (error) { cases.push({ name, passed: false, error: String(error), evidence: evidence() }) }
}
await run('preselected initial mount paints without reselecting', async () => { await setup(); await positioned() })
await run('empty preselected chat paints its prompt on first mount', async () => {
    await setup({ count: 0 }); await positioned()
    assert(getComputedStyle(document.querySelector('[data-conversation-empty]')).visibility === 'visible', 'Empty prompt stayed hidden')
})
await run('selection after the portal mounts positions normally', async () => { await warm() })
await run('selected ID awaiting bootstrap attaches when data arrives', async () => {
    await setup({ loaded: false }); await wait(100)
    assert(!api.pane.current, 'Pane should wait for synthetic bootstrap')
    api.setState(state => ({ ...state, loaded: true })); await positioned()
})
await run('initially inactive mode paints when revealed', async () => {
    await setup({ active: false }); await wait(100)
    api.setState(state => ({ ...state, active: true })); await positioned()
})
await run('mode departure and return retain the mounted pane', async () => {
    await warm(); const pane = api.pane.current
    api.setState(state => ({ ...state, active: false })); await wait(100)
    api.setState(state => ({ ...state, active: true })); await positioned()
    assert(api.pane.current === pane, 'Mode switch discarded resident messages')
})
await run('A to B to A binds each newly mounted pane', async () => {
    await warm(); const first = api.pane.current
    api.setState(state => ({ ...state, selected: 'b' })); await positioned()
    const second = api.pane.current; assert(second !== first, 'Selection did not exercise a new pane')
    assert(paneObserverCount(first) === 0, 'Outgoing selected pane retained its observer')
    api.setState(state => ({ ...state, selected: 'a' })); await positioned()
    assert(api.pane.current !== second, 'Return did not exercise a new pane')
})
await run('pane replacement with unchanged chat ID gains its observer', async () => {
    await warm(); const pane = api.pane.current
    api.setState(state => ({ ...state, epoch: state.epoch + 1 })); await positioned()
    assert(api.pane.current !== pane, 'Replacement case did not replace the pane')
    assert(paneObserverCount(pane) === 0, 'Replaced pane retained its observer')
})
await run('StrictMode preselected portal paints on first mount', async () => { await setup({}, true); await positioned() })
await run('StrictMode close and reopen cleanly attach the next pane', async () => {
    await warm({}, true); const old = api.pane.current
    api.setState(state => ({ ...state, selected: null })); await wait(100)
    assert(!api.pane.current, 'Closed chat retained a pane ref')
    api.setState(state => ({ ...state, selected: 'a' })); await positioned()
    assert(api.pane.current !== old, 'Reopened chat reused a detached pane')
    assert(paneObserverCount(old) === 0, 'StrictMode close leaked its old observer')
})
await run('new messages remain bottom anchored after attachment', async () => {
    await warm(); api.setState(state => ({ ...state, count: state.count + 8 })); await positioned()
    assert(api.pane.current.querySelectorAll('[data-message-interaction]').length === 43, 'Incoming rows did not render')
})
await run('composer growth retains an older message anchor', async () => {
    await warm(); const pane = api.pane.current
    api.follow.current = false; pane.scrollTop = 240; pane.dispatchEvent(new Event('scroll')); await wait(70)
    const row = pane.querySelector('[data-message-interaction="8"]')
    const before = row.getBoundingClientRect().bottom - pane.getBoundingClientRect().bottom
    api.setState(state => ({ ...state, footerHeight: 150 })); await wait(350)
    const after = row.getBoundingClientRect().bottom - pane.getBoundingClientRect().bottom
    assert(Math.abs(before - after) <= 1, `Older-message anchor drifted ${after - before}px`)
    assert(getComputedStyle(pane).visibility === 'visible', 'Composer growth hid messages')
})
root?.unmount(); await wait(30)
await run('unmount releases the portal and its ownership', async () => {
    assert(!document.querySelector('[data-mobile-conversation-surface]'), 'Portal survived unmount')
    assert(document.documentElement.dataset.mobileConversationOpen !== 'true', 'Conversation ownership survived unmount')
    assert(resizeTargets.size === 0, 'Unmount leaked a resize observer')
})
window.commsPaneLifecycleResult = { status: 'complete', total: cases.length, passed: cases.filter(row => row.passed).length, cases }
document.getElementById('result').textContent = JSON.stringify(window.commsPaneLifecycleResult, null, 2)
