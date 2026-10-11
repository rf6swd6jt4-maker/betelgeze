import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { workspacePerformanceEnabled } from '../lib/workspace-native.ts'

function fixture(env) {
    const exports = {}
    const dependencies = {
        'next/headers': { cookies() { throw Error('Protocol rollout must not inspect or authorize cookies') } },
        '@/lib/push/device': { PUSH_DEVICE_COOKIE: 'device', UUID_PATTERN: /./ },
        '@/lib/workspace-native': { workspacePerformanceEnabled },
    }
    const javascript = ts.transpileModule(readFileSync('lib/communications/device-server.ts', 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
    new Function('require', 'exports', 'process', javascript)(name => { assert.ok(name in dependencies); return dependencies[name] }, exports, { env })
    return exports
}
const request = () => new Request('https://be.test/api/unread?readProtocol=device-v1')

test('rollback compatibility retains existing device requests while new shells select account', () => {
    const api = fixture({ WORKSPACE_COMMUNICATIONS_DEVICE_UNREAD_COMPAT: 'workspace', WORKSPACE_PERFORMANCE_USERS: 'user' })
    assert.equal(api.resolveCommunicationReadProtocol('workspace', 'user'), 'account-v1')
    assert.equal(api.communicationDeviceProtocolSupported('workspace', 'user'), true)
    assert.equal(api.validateCommunicationReadProtocol(request(), 'workspace', 'user'), 'device-v1')
    assert.equal(api.validateCommunicationReadProtocol(request(), 'other-workspace', 'user').status, 503)
    assert.equal(api.validateCommunicationReadProtocol(request(), 'workspace', 'other-user').status, 503)
})

test('normal rollout supports device requests and disabled flags fail explicitly without fallback', () => {
    const enabled = fixture({ WORKSPACE_COMMUNICATIONS_DEVICE_UNREAD: 'workspace', WORKSPACE_PERFORMANCE_USERS: 'user' })
    assert.equal(enabled.resolveCommunicationReadProtocol('workspace', 'user'), 'device-v1')
    assert.equal(enabled.validateCommunicationReadProtocol(request(), 'workspace', 'user'), 'device-v1')
    const disabled = fixture({})
    assert.equal(disabled.resolveCommunicationReadProtocol('workspace', 'user'), 'account-v1')
    assert.equal(disabled.communicationDeviceProtocolSupported('workspace', 'user'), false)
    assert.equal(disabled.validateCommunicationReadProtocol(request(), 'workspace', 'user').status, 503)
    assert.equal(disabled.validateCommunicationReadProtocol(new Request('https://be.test/api/unread'), 'workspace', 'user'), 'account-v1')
})
