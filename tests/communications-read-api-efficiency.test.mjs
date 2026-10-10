import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'
import * as roles from '../lib/workspace-roles.ts'
import * as panels from '../lib/workspace-panels.ts'

const base = 'fa1f2cd7'
const compiled = new Map()
function load(variant, path, dependencies, globals = {}) {
    const key = `${variant}:${path}`
    if (!compiled.has(key)) {
        const source = variant === 'baseline'
            ? execFileSync('git', ['show', `${base}:${path}`], { encoding: 'utf8' })
            : readFileSync(path, 'utf8')
        compiled.set(key, ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText)
    }
    const exports = {}
    const require = name => {
        assert.ok(name in dependencies, `Unexpected dependency: ${name}`)
        return dependencies[name]
    }
    new Function('require', 'exports', ...Object.keys(globals), compiled.get(key))(require, exports, ...Object.values(globals))
    return exports
}

const workspaceId = '10000000-0000-4000-8000-000000000001'
const userId = '20000000-0000-4000-8000-000000000002'
const conversationId = '30000000-0000-4000-8000-000000000003'
const messageId = '40000000-0000-4000-8000-000000000004'
const acknowledgedAt = '2026-10-10T12:00:00.123456Z'
const workspace = {
    id: workspaceId, name: 'Fixture workspace', slug: 'fixture', status: 'active',
    banner_path: null, logo_path: null, banner_height: 192, banner_position: 50,
    leadgen_banner_path: null, leadgen_banner_height: 192, leadgen_banner_position: 50,
    custom_onboarding_domain: null, custom_onboarding_domain_status: 'none',
    custom_onboarding_domain_records: [], custom_onboarding_domain_error: null,
    custom_client_portal_domain: null, custom_client_portal_domain_status: 'none',
    custom_client_portal_domain_records: [], custom_client_portal_domain_error: null,
}

function fixture(variant, kind, options = {}) {
    const clients = [], verifiedClients = [], queries = [], rpcCalls = [], afterCallbacks = [], cleanups = [], warnings = [], marks = []
    const createSupabaseServerClient = async () => {
        const client = { id: clients.length + 1, rpc: async (name, input) => {
            rpcCalls.push({ clientId: client.id, name, input })
            if (options.rpcThrows) throw new Error(options.rpcThrows)
            return { error: options.rpcError ? { code: options.rpcError } : null, data: options.noPosition ? null : {
                workspaceId, userId, kind, conversationId,
                lastReadMessageId: options.acknowledgedMessageId ?? messageId, lastReadAt: acknowledgedAt,
            } }
        } }
        clients.push(client)
        return client
    }
    const supabaseAdmin = { from: table => {
        const query = { table, fields: '', filters: [], resultBytes: null }
        queries.push(query)
        const builder = {
            select: fields => { query.fields = fields; return builder },
            eq: (key, value) => { query.filters.push([key, value]); return builder },
            maybeSingle: async () => {
                if (table === 'workspaces') {
                    if (options.workspaceError) return { data: null, error: { message: options.workspaceError } }
                    if (options.legacySchema && query.fields.includes('custom_onboarding_domain')) return { data: null, error: { message: 'custom_onboarding_domain missing' } }
                    const record = options.missingWorkspace ? null : { ...workspace, ...(options.workspace ?? {}) }
                    const data = record && Object.fromEntries(query.fields.split(',').map(field => field.trim()).map(field => [field, record[field]]))
                    query.resultBytes = Buffer.byteLength(JSON.stringify(data))
                    return { data, error: null }
                }
                assert.equal(table, 'workspace_memberships')
                return { data: options.missingMembership ? null : { role: options.role ?? 'staff' }, error: options.membershipError ? { message: options.membershipError } : null }
            },
        }
        return builder
    } }
    const navigation = {
        redirect: path => { throw new Error(`redirect:${path}`) },
        notFound: () => { throw new Error('not-found') },
    }
    const timing = {
        markChatBoundary: name => marks.push(name),
        withChatPerformance: (name, handler) => { assert.equal(name, 'message.read'); return handler },
    }
    const workspaceFunctions = load(variant, 'lib/workspaces.ts', {
        'next/navigation': navigation, react: { cache: fn => fn },
        '@/lib/auth/aal': { getAal2User: async () => ({ id: userId }), requireAal2User: async client => {
            verifiedClients.push(client.id)
            if (options.authError) throw new Error(options.authError)
            return { id: userId }
        } },
        '@/lib/supabase/server': { createSupabaseServerClient },
        '@/lib/supabase/admin': { supabaseAdmin }, '@/lib/workspace-roles': roles,
    })
    const access = load(variant, 'lib/communications/workspace-access.ts', {
        'server-only': {}, 'next/navigation': navigation,
        '@/lib/workspaces': workspaceFunctions, '@/lib/workspace-panels': panels,
        './performance-server': timing,
    })
    const path = `app/api/workspaces/[workspaceSlug]/communications/${kind === 'native' ? 'native/' : ''}read/route.ts`
    const route = load(variant, path, {
        '@/lib/communications/performance-server': timing,
        'next/server': { after: callback => afterCallbacks.push(callback) },
        '@/lib/supabase/server': { createSupabaseServerClient },
        '@/lib/communications/workspace-access': access,
        '@/lib/push/chat-notifications': { clearReadChatPushNotifications: async input => {
            cleanups.push(input)
            if (options.cleanupThrows) throw new Error('cleanup unavailable')
        } },
    }, { console: { warn: message => warnings.push(message) } })
    const defaultBody = { [kind === 'native' ? 'conversationId' : 'relationshipId']: conversationId, messageId }
    const run = async () => {
        const request = new Request('https://fixture.test/api/workspaces/fixture/communications/read', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: options.rawBody ?? JSON.stringify({ ...defaultBody, ...(options.body ?? {}) }),
        })
        let outcome
        try {
            const response = await route.POST(request, { params: Promise.resolve({ workspaceSlug: 'fixture' }) })
            outcome = { status: response.status, headers: [...response.headers], body: await response.json() }
        } catch (error) { outcome = { thrown: error.message } }
        assert.equal(cleanups.length, 0, 'legacy cleanup is scheduled after the response, never awaited inside the save')
        for (const callback of afterCallbacks) await callback()
        return { outcome, clients: clients.length, verifiedClients, rpcCalls, queries, scheduled: afterCallbacks.length, cleanups, warnings, marks }
    }
    return { run }
}

const scenarios = [
    ['successful read', {}],
    ['shared cursor already ahead', { acknowledgedMessageId: '50000000-0000-4000-8000-000000000005' }],
    ['cleanup failure', { cleanupThrows: true }],
    ['spoofed body scope', { body: { userId: 'attacker', workspaceId: 'other', workspaceSlug: 'other', cursor: { lastReadAt: '2099-01-01' } } }],
    ['invalid message', { body: { messageId: 'invalid' } }],
    ['missing message', { body: { messageId: null } }],
    ['malformed JSON', { rawBody: '{' }],
    ['conversation denied', { rpcError: '42501' }],
    ['RPC unavailable', { rpcError: 'XX000' }],
    ['RPC missing result', { noPosition: true }],
    ['RPC network rejection', { rpcThrows: 'network unavailable' }],
    ['authentication rejected', { authError: 'login redirect' }],
    ['MFA rejected', { authError: 'MFA redirect' }],
    ['workspace absent', { missingWorkspace: true }],
    ['workspace suspended', { workspace: { status: 'suspended' } }],
    ['membership absent', { missingMembership: true }],
    ['membership role invalid', { role: 'viewer' }],
    ['legacy member role', { role: 'member' }],
    ['workspace read failure', { workspaceError: 'database unavailable' }],
    ['membership read failure', { membershipError: 'database unavailable' }],
    ['legacy branding columns absent', { legacySchema: true }],
]

for (const kind of ['client', 'native']) {
    for (const [name, options] of scenarios) test(`${kind} read route preserves baseline ${name} behavior`, async () => {
        const before = await fixture('baseline', kind, options).run()
        const after = await fixture('candidate', kind, options).run()
        assert.deepEqual(after.outcome, before.outcome)
        assert.deepEqual(after.rpcCalls.map(({ name, input }) => ({ name, input })), before.rpcCalls.map(({ name, input }) => ({ name, input })))
        assert.equal(after.scheduled, before.scheduled)
        assert.deepEqual(after.cleanups, before.cleanups)
        assert.deepEqual(after.warnings, before.warnings)
        assert.deepEqual(after.marks, before.marks)
        assert.equal(after.clients, 1, 'the route and canonical guard share one request-scoped client')
        assert.deepEqual(after.verifiedClients, [1])
        assert.equal(before.clients, before.rpcCalls.length ? 2 : 1, 'baseline guard constructs a client before the route constructs its mutation client')
        for (const call of after.rpcCalls) {
            assert.equal(call.clientId, after.verifiedClients[0], 'the mutation uses the same client validated by AAL2')
            assert.deepEqual(call.input, { p_workspace_id: workspaceId, p_kind: kind, p_conversation_id: conversationId, p_message_id: messageId })
        }
        if (after.outcome.status === 200) {
            assert.equal(after.outcome.body.cursor.userId, userId)
            assert.equal(after.outcome.body.cursor.workspaceId, workspaceId)
            assert.equal(after.outcome.body.notificationReadThrough, acknowledgedAt)
            assert.equal(after.outcome.body.cursor[kind === 'native' ? 'conversationId' : 'relationshipId'], conversationId)
            assert.equal(after.scheduled, 1)
            assert.deepEqual(after.cleanups, [{ userId, conversationKind: kind, conversationId, readThroughCreatedAt: acknowledgedAt }])
        } else assert.equal(after.scheduled, 0)
    })

    test(`${kind} read route rejects wrong conversation types without constructing a mutation client`, async () => {
        const options = { body: { [kind === 'native' ? 'conversationId' : 'relationshipId']: ['not-a-conversation'] } }
        const before = await fixture('baseline', kind, options).run()
        const after = await fixture('candidate', kind, options).run()
        assert.deepEqual(after.outcome, before.outcome)
        assert.equal(before.clients, 1)
        assert.equal(after.clients, 1)
        assert.equal(after.rpcCalls.length, 0)
        assert.equal(after.scheduled, 0)
    })
}

test('read workspace identity projection omits presentation data while retaining identical authorization filters', async context => {
    for (const populated of [false, true]) {
        const options = populated ? { workspace: {
            name: 'Configured fixture agency', banner_path: 'workspaces/fixture/banner.webp', logo_path: 'workspaces/fixture/logo.webp',
            leadgen_banner_path: 'workspaces/fixture/leadgen.webp',
            custom_onboarding_domain: 'onboarding.fixture.test', custom_onboarding_domain_status: 'verified',
            custom_onboarding_domain_records: [{ type: 'CNAME', name: 'onboarding', value: 'example.fixture.test' }],
            custom_client_portal_domain: 'portal.fixture.test', custom_client_portal_domain_status: 'verified',
            custom_client_portal_domain_records: [{ type: 'CNAME', name: 'portal', value: 'example.fixture.test' }],
        } } : {}
        const before = await fixture('baseline', 'client', options).run()
        const after = await fixture('candidate', 'client', options).run()
        assert.equal(before.queries.length, 2)
        assert.equal(after.queries.length, 2, 'query count is unchanged; the workspace row projection is smaller')
        assert.deepEqual(after.queries.map(({ table, filters }) => ({ table, filters })), before.queries.map(({ table, filters }) => ({ table, filters })))
        const oldRow = before.queries[0], newRow = after.queries[0]
        assert.equal(oldRow.fields.split(',').length, 19)
        assert.equal(newRow.fields, 'id, slug, status')
        assert.ok(newRow.resultBytes < oldRow.resultBytes)
        context.diagnostic(`${populated ? 'Configured' : 'Null-branding'} fixture workspace projection: ${oldRow.resultBytes} -> ${newRow.resultBytes} JSON bytes (19 -> 3 selected fields); synthetic row serialization, not production timing.`)
    }
})
