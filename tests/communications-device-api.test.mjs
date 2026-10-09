import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const [workspaceId, userId, deviceId, otherDevice, conversationId, messageId] = [1, 2, 3, 4, 5, 6].map(uuid)
function load(path, dependencies) {
    const compiledModule = { exports: {} }
    const code = ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
    runInNewContext(code, { module: compiledModule, exports: compiledModule.exports, require: name => {
        if (!(name in dependencies)) throw Error(`Unexpected dependency ${name}`)
        return dependencies[name]
    }, Request, Response, URL, console })
    return compiledModule.exports
}
function harness(kind = 'native', options = {}) {
    const calls = [], afterTasks = []
    const cookie = options.cookie === undefined ? deviceId : options.cookie
    const server = load('lib/communications/device-server.ts', {
        'next/headers': { cookies: async () => ({ get: () => cookie ? { value: cookie } : undefined }) },
        '@/lib/push/device': { PUSH_DEVICE_COOKIE: 'betelgeze_push_device', UUID_PATTERN: /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i },
    })
    const deviceCursor = { workspaceId, userId, kind, conversationId, lastReadMessageId: messageId, lastReadAt: '2026-10-09T12:00:00.123456Z' }
    const receiptCursor = { ...deviceCursor, lastReadMessageId: uuid(99), lastReadAt: '2026-10-09T13:00:00.123456Z' }
    const dependencies = {
        '@/lib/communications/device-server': server,
        '@/lib/communications/performance-server': { withChatPerformance: (_name, handler) => handler },
        '@/lib/communications/workspace-access': { requireCommunicationsWorkspace: async () => {
            if (options.denied) throw Error('Access denied')
            return { workspace: { id: workspaceId }, user: { id: userId } }
        } },
        '@/lib/supabase/server': { createSupabaseServerClient: async () => ({ rpc: async (name, args) => {
            calls.push({ name, args })
            if (options.error) return { data: null, error: { code: options.error } }
            if (name === 'advance_communication_device_read') return { data: { deviceId, cursor: receiptCursor, deviceCursor }, error: null }
            if (name === 'communication_device_unread_summary') return { data: { deviceId, conversations: [], cursorsIncluded: args.p_include_cursors, ...(args.p_include_cursors ? { readCursors: [deviceCursor] } : {}) }, error: null }
            return { data: name === 'communication_unread_summary' ? [] : receiptCursor, error: null }
        } }) },
        'next/server': { after: callback => afterTasks.push(callback) },
        '@/lib/push/chat-notifications': { clearReadChatPushNotifications: async () => undefined },
    }
    const root = 'app/api/workspaces/[workspaceSlug]/communications/'
    const read = load(`${root}${kind === 'native' ? 'native/' : ''}read/route.ts`, dependencies).POST
    const unread = load(`${root}unread/route.ts`, dependencies).GET
    const context = { params: Promise.resolve({ workspaceSlug: 'fixture' }) }
    const post = body => read(new Request('https://app.test/api/read', { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }), context)
    return { calls, afterTasks, deviceCursor, receiptCursor, post, body: { [kind === 'native' ? 'conversationId' : 'relationshipId']: conversationId, messageId, deviceId }, get: query => unread(new Request(`https://app.test/api/unread${query ?? '?scope=device&cursors=1'}`), context) }
}
for (const kind of ['client', 'native']) {
    test(`${kind}: cookie selects installation, one RPC returns independent device and account acknowledgement`, async () => {
        const h = harness(kind), response = await h.post(h.body), data = await response.json()
        assert.equal(response.status, 200)
        assert.deepEqual(data.deviceCursor, h.deviceCursor)
        assert.deepEqual(data.cursor, h.receiptCursor)
        assert.equal(h.calls.length, 1)
        assert.equal(h.calls[0].name, 'advance_communication_device_read')
        assert.deepEqual(JSON.parse(JSON.stringify(h.calls[0].args)), { p_workspace_id: workspaceId, p_device_id: deviceId, p_kind: kind, p_conversation_id: conversationId, p_message_id: messageId })
        assert.match(response.headers.get('cache-control'), /no-store/)
        assert.equal(h.afterTasks.length, 1, 'existing notification cleanup remains after acknowledgement')
    })
    test(`${kind}: forged or missing installation cannot write any cursor`, async () => {
        for (const cookie of [deviceId, null, 'malformed']) {
            const h = harness(kind, { cookie })
            const response = await h.post({ ...h.body, deviceId: otherDevice })
            assert.equal(response.status, 409)
            assert.equal(h.calls.length, 0)
        }
    })
    test(`${kind}: denied or unavailable device writes never fall back to account writes`, async () => {
        for (const [error, status] of [['P0002', 409], ['42501', 404], ['42P01', 503]]) {
            const h = harness(kind, { error })
            assert.equal((await h.post(h.body)).status, status)
            assert.equal(h.calls.length, 1)
            assert.equal(h.calls[0].name, 'advance_communication_device_read')
        }
    })
    test(`${kind}: older clients retain the account read protocol during rollout`, async () => {
        const h = harness(kind), body = { ...h.body }
        delete body.deviceId
        assert.equal((await h.post(body)).status, 200)
        assert.equal(h.calls[0].name, 'advance_communication_read')
        assert.equal(h.afterTasks.length, 1)
    })
    test(`${kind}: membership failure occurs before any device read`, async () => {
        const h = harness(kind, { denied: true })
        await assert.rejects(() => h.post(h.body), /Access denied/)
        assert.equal(h.calls.length, 0)
    })
}
test('device summary returns counts and cursors from one scoped RPC', async () => {
    const h = harness(), response = await h.get(), data = await response.json()
    assert.equal(response.status, 200)
    assert.equal(data.deviceId, deviceId)
    assert.deepEqual(data.readCursors, [h.deviceCursor])
    assert.equal(h.calls.length, 1)
    assert.equal(h.calls[0].args.p_device_id, deviceId)
    assert.match(response.headers.get('cache-control'), /no-store/)
})
test('device summary does not treat missing identity or missing schema as zero unread', async () => {
    for (const [options, status] of [[{ cookie: null }, 409], [{ error: 'P0002' }, 409], [{ error: '42P01' }, 503], [{ error: '42501' }, 403]]) {
        const h = harness('native', options), response = await h.get(), data = await response.json()
        assert.equal(response.status, status)
        assert.equal('conversations' in data, false)
    }
})
test('old summary protocol remains account-level and ignores supplied target device', async () => {
    const h = harness(), response = await h.get(`?deviceId=${otherDevice}`)
    assert.equal(response.status, 200)
    assert.equal(h.calls[0].name, 'communication_unread_summary')
    assert.equal('p_device_id' in h.calls[0].args, false)
})

test('routine unread metadata omits cursor snapshots without introducing a second request', async () => {
    const h = harness(), response = await h.get('?scope=device'), data = await response.json()
    assert.equal(response.status, 200)
    assert.equal(data.cursorsIncluded, false)
    assert.equal('readCursors' in data, false)
    assert.equal(h.calls.length, 1)
    assert.equal(h.calls[0].args.p_include_cursors, false)
})
