// Synthetic missed-event faults, real React hooks and iframe geometry. These
// reproduce recovery gaps; they do not identify a production browser's trigger.
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { useConversationRead } from './useConversationRead.js'
import { useConversationLayout } from './useConversationLayout.js'
import { useChatDocumentAttention } from './useChatDocumentAttention.js'
import { subscribeChatReads } from './read-state.js'
import { subscribeDeviceChatReads } from './device-read-state.js'

const h = React.createElement, host = window.top
const wait = ms => new Promise(done => setTimeout(done, ms))
const assert = (ok, message) => { if (!ok) throw Error(message) }
const until = async (predicate, label) => {
    for (let i = 0; i < 150; i++) { if (predicate()) return; await wait(20) }
    throw Error('Timed out: ' + label)
}
const message = n => ({ id: `message-${n}`, createdAt: `2026-10-21T12:00:00.${String(n).padStart(6, '0')}Z` })
const focusDescriptor = Object.getOwnPropertyDescriptor(host.document, 'hasFocus')
const restoreFocus = () => {
    if (focusDescriptor) Object.defineProperty(host.document, 'hasFocus', focusDescriptor)
    else delete host.document.hasFocus
}
const loseFocus = () => Object.defineProperty(host.document, 'hasFocus', { configurable: true, value: () => false })
const signal = () => {
    for (const view of [host, window]) {
        view.dispatchEvent(new Event('focus'))
        view.dispatchEvent(new Event('pageshow'))
        view.document.dispatchEvent(new Event('visibilitychange'))
    }
}
let root, api, requests, acknowledgements, readGates
const cases = []

function App({ kind, protocol, initial }) {
    const [state, setState] = useState({ active: true, known: true, latest: message(1), ...initial })
    const [cursor, setCursor] = useState(null), [atLatest, setAtLatest] = useState(true)
    const [, setShowJump] = useState(false)
    const pane = useRef(null), follow = useRef(true)
    const attach = useConversationLayout(pane, follow, 'chat', state.active, setAtLatest, setShowJump)
    const attention = useChatDocumentAttention()
    const reading = useConversationRead({ workspaceId: 'workspace', workspaceSlug: 'fixture', userId: 'user', kind,
        conversationId: 'chat', latest: state.latest, cursor, cursorKnown: state.known,
        readProtocol: protocol, deviceId: protocol === 'device-v1' ? 'device' : null, active: state.active, atLatest, pane })
    useEffect(() => {
        const subscribe = protocol === 'device-v1' ? subscribeDeviceChatReads : subscribeChatReads
        return subscribe('workspace', 'user', read => {
            // The same confirmation arrives locally and via BroadcastChannel.
            // Count confirmed positions, not duplicate transports of an ACK.
            if (acknowledgements.some(previous => previous.lastReadMessageId === read.lastReadMessageId && previous.lastReadAt === read.lastReadAt)) return
            acknowledgements.push(read)
            if (!state.holdCursor) setCursor(read)
        })
    }, [protocol, state.holdCursor])
    useLayoutEffect(() => { api = { setState, attention, reading, cursor, pane: pane.current, atLatest } }, [attention, reading, cursor, atLatest])
    return h('section', { className: 'fixture-chat' }, h('header', null, 'Synthetic retained chat'),
        h('div', { ref: attach, className: 'fixture-pane', 'data-message-pane': true, style: { display: 'block' } },
            h('div', null, Array.from({ length: 18 }, (_, i) => h('div', {
                key: i, style: { height: 80 }, 'data-message-interaction': i === 17 ? state.latest.id : `old-${i}`,
                'data-message-scroll-anchor': `row-${i}`,
            }, 'Synthetic message ' + i)))), h('footer', null, 'Composer'))
}

async function setup(kind, protocol, initial = {}) {
    root?.unmount(); root = null
    restoreFocus()
    for (const doc of [document, host.document]) doc.querySelectorAll('.lifecycle-cover').forEach(node => node.remove())
    host.document.body.dataset.workspaceActiveTabId = 'fixture-tab'
    sessionStorage.clear()
    await wait(30)
    requests = []; acknowledgements = []; readGates = []; api = null
    window.fetch = async (url, options) => {
        assert(new URL(url, location.origin).pathname.endsWith('/read'), 'unexpected request: ' + url)
        const body = JSON.parse(options.body)
        const cursor = { workspaceId: 'workspace', userId: 'user', kind, conversationId: 'chat',
            lastReadMessageId: body.messageId, lastReadAt: message(Number(body.messageId.split('-')[1])).createdAt }
        requests.push(body)
        if (readGates.length) await readGates.shift()
        return { ok: true, status: 200, json: async () => ({ cursor, readProtocol: protocol, deviceId: 'device', deviceCursor: { ...cursor, deviceId: 'device' } }) }
    }
    root = createRoot(document.getElementById('stage'))
    root.render(h(App, { kind, protocol, initial }))
    await until(() => api?.pane?.dataset.positioned === 'true', 'positioned reader')
}
async function run(name, body) {
    try { await body(); cases.push({ name, passed: true }) }
    catch (error) { cases.push({ name, passed: false, error: String(error) }) }
    finally { restoreFocus() }
}
await until(() => host.document.hasFocus(), 'foreground host')
for (const kind of ['native', 'client']) for (const protocol of ['account-v1', 'device-v1']) {
    const runCase = (name, body) => run(`${kind} ${protocol} ${name}`, body)
    await runCase('host focus rechecks when attention snapshot stayed true', async () => {
        await setup(kind, protocol)
        await until(() => acknowledgements.length === 1, 'initial acknowledgement')
        // No blur is delivered, so React's attention snapshot stays true while
        // the synchronous predicate correctly refuses the next observation.
        loseFocus(); api.setState(s => ({ ...s, latest: message(2) }))
        await wait(180)
        assert(requests.length === 1 && api.attention.attentive && !api.reading.isReading(), 'fault did not retain stale attention safely')
        restoreFocus(); host.dispatchEvent(new Event('focus'))
        await until(() => acknowledgements.length === 2, 'host focus without scrolling')
        await until(() => api.cursor?.lastReadMessageId === message(2).id, 'confirmed newest cursor rendered')
    })
    await runCase('iframe-only focus restores an inactive attention snapshot', async () => {
        await setup(kind, protocol)
        await until(() => acknowledgements.length === 1, 'initial acknowledgement')
        loseFocus(); host.dispatchEvent(new Event('blur'))
        await until(() => !api.attention.attentive, 'departure observed')
        api.setState(s => ({ ...s, latest: message(2) })); await wait(100)
        restoreFocus(); window.dispatchEvent(new Event('focus'))
        await until(() => acknowledgements.length === 2 && api.attention.attentive, 'iframe focus without host focus')
    })
    await runCase('resume bursts do not duplicate an acknowledged save with a delayed parent cursor', async () => {
        await setup(kind, protocol, { holdCursor: true })
        await until(() => acknowledgements.length === 1, 'initial acknowledgement')
        for (let i = 0; i < 10; i++) { signal(); await wait(40) }
        assert(requests.length === 1, 'duplicate acknowledged read')
    })
    await runCase('focus events cannot substitute for actual foreground attention', async () => {
        await setup(kind, protocol)
        await until(() => acknowledgements.length === 1, 'initial acknowledgement')
        loseFocus(); api.setState(s => ({ ...s, latest: message(2) })); signal(); await wait(180)
        assert(requests.length === 1, 'background message read')
        restoreFocus(); window.dispatchEvent(new Event('focus'))
        await until(() => acknowledgements.length === 2, 'real focus recovery')
    })
    for (const scope of ['local', 'host']) await runCase(`${scope} overlay stays unread through resume events`, async () => {
        await setup(kind, protocol)
        await until(() => acknowledgements.length === 1, 'initial acknowledgement')
        const doc = scope === 'host' ? host.document : document, cover = doc.createElement('div')
        cover.className = 'lifecycle-cover'; cover.style.cssText = 'position:fixed;inset:0;z-index:999999;background:black'
        doc.body.append(cover)
        api.setState(s => ({ ...s, latest: message(2) })); signal(); await wait(180)
        assert(requests.length === 1, 'covered row read')
        cover.remove(); await until(() => acknowledgements.length === 2, 'overlay removed')
    })
    await runCase('inactive chat stays unread through resume events', async () => {
        await setup(kind, protocol, { active: false }); signal(); await wait(180)
        assert(requests.length === 0, 'inactive chat read')
        api.setState(s => ({ ...s, active: true })); await until(() => acknowledgements.length === 1, 'chat activation')
    })
    await runCase('inactive shell tab stays unread through resume events', async () => {
        await setup(kind, protocol)
        await until(() => acknowledgements.length === 1, 'initial acknowledgement')
        host.document.body.dataset.workspaceActiveTabId = 'other-tab'
        api.setState(s => ({ ...s, latest: message(2) })); signal(); await wait(180)
        assert(requests.length === 1, 'inactive shell tab read')
        host.document.body.dataset.workspaceActiveTabId = 'fixture-tab'
        await until(() => acknowledgements.length === 2, 'shell tab restoration')
    })
    await runCase('scrolled-up chat stays unread through resume events', async () => {
        await setup(kind, protocol)
        await until(() => acknowledgements.length === 1, 'initial acknowledgement')
        api.pane.scrollTop = 0
        await until(() => !api.atLatest, 'history scrolled up')
        api.setState(s => ({ ...s, latest: message(2) })); signal(); await wait(180)
        assert(requests.length === 1, 'unseen latest row read')
        api.pane.scrollTop = api.pane.scrollHeight
        await until(() => acknowledgements.length === 2, 'newest row visible')
    })
    await runCase('focus recovery still waits for server acknowledgement', async () => {
        await setup(kind, protocol)
        await until(() => acknowledgements.length === 1, 'initial acknowledgement')
        loseFocus(); api.setState(s => ({ ...s, latest: message(2) })); await wait(180)
        let release
        readGates.push(new Promise(done => { release = done }))
        try {
            restoreFocus(); host.dispatchEvent(new Event('focus'))
            await until(() => requests.length === 2, 'pending resumed save')
            assert(acknowledgements.length === 1 && api.cursor.lastReadMessageId === message(1).id, 'unconfirmed read published')
        } finally { release() }
        await until(() => acknowledgements.length === 2, 'confirmed resumed save')
    })
}
root?.unmount(); restoreFocus()
host.commsReadingFixtureResult = { status: 'complete', total: cases.length, passed: cases.filter(row => row.passed).length, cases }
host.document.getElementById('result').textContent = JSON.stringify(host.commsReadingFixtureResult, null, 2)
