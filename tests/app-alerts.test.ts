import assert from 'node:assert/strict'
import test from 'node:test'
import { createChatReadQueue } from '../lib/communications/read-queue.ts'
import { latestMessageIsVisible } from '../lib/communications/reading-visibility.ts'
import { clientConversationUnreadCount, nativeConversationUnreadCount } from '../lib/communications/unread.ts'
import { workspaceDocumentIsActive } from '../lib/workspace-tab-activity.ts'
import { publishUnreadSummary, subscribeUnreadSummary } from '../lib/communications/unread-broadcast.ts'
import type { ChatReadUpdate } from '../lib/communications/read-state.ts'
const read = (conversationId = 'a', n = 1): ChatReadUpdate => ({ conversationId, kind: 'native', userId: 'u', workspaceId: 'w', lastReadMessageId: `m${n}`, lastReadAt: `2026-09-17T10:00:0${n}.123456Z` })

test('failed reads remain separate across chats and survive reload without optimistic acknowledgement', async () => {
    let stored: ChatReadUpdate[] = [], fail = true
    const acknowledged: ChatReadUpdate[] = [], errors: (string | null)[] = []
    const config = { load: () => stored, store: (rows: ChatReadUpdate[]) => { stored = rows }, save: async (r: ChatReadUpdate) => { if (fail) throw Error('offline'); return r }, acknowledge: (r: ChatReadUpdate) => acknowledged.push(r), error: (e: string | null) => errors.push(e) }
    const first = createChatReadQueue(config)
    first.observe(read('a')); first.observe(read('b'))
    await first.flush()
    assert.deepEqual(stored.map(r => r.conversationId), ['a', 'b'])
    assert.equal(acknowledged.length, 0)
    assert.match(errors.at(-1)!, /could not be saved/)
    first.dispose(); fail = false
    const restored = createChatReadQueue(config)
    await restored.flush()
    assert.equal(acknowledged.length, 2); assert.equal(stored.length, 0); assert.equal(errors.at(-1), null)
})

test('a late acknowledgement cannot discard a newer observed message; saves serialize and coalesce', async () => {
    const attempts: ChatReadUpdate[] = [], acknowledgements: ChatReadUpdate[] = []
    const completions: (() => void)[] = []
    const queue = createChatReadQueue({ load: () => [], store() {}, error() {}, acknowledge: r => acknowledgements.push(r), save: r => { attempts.push(r); return new Promise(resolve => completions.push(() => resolve(r))) } })
    queue.observe(read('a', 1)); queue.observe(read('a', 2)); queue.observe(read('a', 3))
    assert.equal(attempts.length, 1)
    const running = queue.flush(); completions.shift()!()
    await Promise.resolve(); await Promise.resolve()
    assert.deepEqual(attempts.map(r => r.lastReadMessageId), ['m1', 'm3'])
    completions.shift()!(); await running
    assert.deepEqual(acknowledgements.map(r => r.lastReadMessageId), ['m1', 'm3'])
})

test('account mismatches and older server responses cannot acknowledge a pending read', async () => {
    for (const result of [{ ...read(), userId: 'someone-else' }, read('a', 0)]) {
        let stored: ChatReadUpdate[] = []
        const queue = createChatReadQueue({ load: () => [], store: rows => { stored = rows }, save: async () => result, acknowledge: () => assert.fail('invalid acknowledgement'), error() {} })
        queue.observe(read()); await queue.flush(); assert.equal(stored.length, 1)
    }
})

test('closing a reader preserves unacknowledged intent and prevents late cross-account publication', async () => {
    let finish!: (r: ChatReadUpdate) => void
    let stored: ChatReadUpdate[] = []
    const queue = createChatReadQueue({ load: () => [], store: rows => { stored = rows }, save: () => new Promise(resolve => { finish = resolve }), acknowledge: () => assert.fail('disposed owner'), error() {} })
    queue.observe(read()); const pending = queue.flush(); queue.dispose(); finish(read()); await pending
    assert.equal(stored.length, 1)
})

test('a selected visible chat does not erase unacknowledged unread badges', () => {
    const m = { id: 'm', createdAt: read().lastReadAt, direction: 'inbound' as const, senderUserId: 'other' }
    assert.equal(clientConversationUnreadCount({ messages: [m] }, undefined, true), 1)
    assert.equal(nativeConversationUnreadCount({ messages: [m] }, undefined, 'u', true), 1)
})

test('visibility requires a positioned latest row inside the real viewport', () => {
    const original = globalThis.CSS
    Object.assign(globalThis, { CSS: { escape: (id: string) => id } })
    let bottom = 460, positioned = 'true', height = 500, scrolled = 0, keyboard = 600, exists = true, covered = false, inert = false
    const row = { closest: () => inert ? {} : null, getBoundingClientRect: () => ({ top: bottom - 100, bottom, height: 100, left: 0, right: 300 }), contains: () => false }
    const pane = { closest: () => inert ? {} : null, get dataset() { return { positioned } }, get clientHeight() { return height }, scrollHeight: 500, get scrollTop() { return scrolled },
        ownerDocument: { elementFromPoint: () => covered ? null : row, defaultView: { get visualViewport() { return { offsetTop: 0, height: keyboard } } } },
        getBoundingClientRect: () => ({ top: 0, bottom: 500 }), querySelector: () => exists ? row : null }
    try {
        assert.equal(latestMessageIsVisible(pane as unknown as HTMLElement, 'm'), true)
        inert = true; assert.equal(latestMessageIsVisible(pane as unknown as HTMLElement, 'm'), false); inert = false
        covered = true; assert.equal(latestMessageIsVisible(pane as unknown as HTMLElement, 'm'), false); covered = false
        bottom = 650; assert.equal(latestMessageIsVisible(pane as unknown as HTMLElement, 'm'), false)
        bottom = 460; keyboard = 400; assert.equal(latestMessageIsVisible(pane as unknown as HTMLElement, 'm'), false)
        keyboard = 600; positioned = 'false'; assert.equal(latestMessageIsVisible(pane as unknown as HTMLElement, 'm'), false)
        positioned = 'true'; height = 0; assert.equal(latestMessageIsVisible(pane as unknown as HTMLElement, 'm'), false)
        height = 500; scrolled = -100; assert.equal(latestMessageIsVisible(pane as unknown as HTMLElement, 'm'), false)
        scrolled = 0; exists = false; assert.equal(latestMessageIsVisible(pane as unknown as HTMLElement, 'm'), false)
    } finally { Object.assign(globalThis, { CSS: original }) }
})

test('native panel identity and hosted document identity are not interchangeable', () => {
    const old = { window: globalThis.window, document: globalThis.document }
    const host = { parent: null as unknown, document: { body: { dataset: { workspaceTabsHosted: 'true', workspaceActiveTabId: 'native' } } } }
    host.parent = host
    Object.assign(globalThis, { window: host, document: host.document })
    try { assert.equal(workspaceDocumentIsActive('native'), true); assert.equal(workspaceDocumentIsActive('other'), false); assert.equal(workspaceDocumentIsActive(), false) }
    finally { Object.assign(globalThis, old) }
})

test('shell summary reaches resident copies and late mounts without mixing accounts', () => {
    const old = globalThis.window
    Object.assign(globalThis, { window: { top: new EventTarget() } })
    const snapshot = { workspaceId: 'w', userId: 'u', rows: [], stale: false }, received: unknown[] = []
    try {
        publishUnreadSummary(snapshot)
        const unsubscribe = subscribeUnreadSummary('w', 'u', s => received.push(s))
        assert.deepEqual(received, [snapshot])
        publishUnreadSummary({ ...snapshot, userId: 'other' }); assert.equal(received.length, 1)
        publishUnreadSummary({ ...snapshot, stale: true }); assert.equal(received.length, 2)
        unsubscribe()
    } finally { Object.assign(globalThis, { window: old }) }
})

test('notification dismissal preserves a newer same-timestamp message and unknown identity', async () => {
    const { dismissReadChatNotification } = await import('../lib/push/browser-notifications.ts')
    const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
    const closed: string[] = []
    const items = [
        { name: 'older', messageId: 'a', messageCreatedAt: '2026-09-17T10:00:00.123455Z' },
        { name: 'equal', messageId: 'b', messageCreatedAt: '2026-09-17T10:00:00.123456+00:00' },
        { name: 'newer-tie', messageId: 'c', messageCreatedAt: '2026-09-17T10:00:00.123456Z' },
        { name: 'newer-time', messageId: 'a', messageCreatedAt: '2026-09-17T10:00:00.123457Z' },
        { name: 'unknown' },
    ].map(item => ({ data: { conversationId: 'chat', ...item }, tag: 'chat:chat', close: () => closed.push(item.name) }))
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { serviceWorker: { getRegistration: async () => ({ getNotifications: async () => items }) } } })
    try { await dismissReadChatNotification('chat', '2026-09-17T10:00:00.123456Z', 'b'); assert.deepEqual(closed, ['older', 'equal']) }
    finally { if (original) Object.defineProperty(globalThis, 'navigator', original) }
})

test('the rendered latest message uses the same timestamp/ID ordering as read and push decisions', async () => {
    const { compareChatMessages } = await import('../lib/record-version.js')
    const rows = [{ id: 'c', createdAt: '2026-09-17T10:00:00.123456+00:00' }, { id: 'b', createdAt: '2026-09-17T10:00:00.123456Z' }, { id: 'z', createdAt: '2026-09-17T10:00:00.123455Z' }]
    assert.deepEqual(rows.sort(compareChatMessages).map(row => row.id), ['z', 'b', 'c'])
})

test('read receipt avatars and ticks cannot claim a newer same-timestamp message was read', async () => {
    const { readCursorCoversMessage } = await import('../lib/communications/read-state.ts')
    const cursor = { lastReadAt: '2026-09-17T10:00:00.123456Z', lastReadMessageId: 'b' }
    assert.equal(readCursorCoversMessage(cursor, { id: 'a', createdAt: '2026-09-17T10:00:00.123456+00:00' }), true)
    assert.equal(readCursorCoversMessage(cursor, { id: 'c', createdAt: '2026-09-17T10:00:00.123456Z' }), false)
})
