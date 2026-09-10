import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

// Execute the actual coordinator with isolated database/provider adapters.
const source = readFileSync(new URL('../lib/client-messages/omnichannel.ts', import.meta.url), 'utf8')
const code = ts.transpileModule(source.slice(source.indexOf('export async function sendCommunicationDeliveries')).replace('export async', 'async'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText
const meta = { provider: 'meta_whatsapp', primary: true, address: 'fixture-meta', channelId: null }
const sms = { provider: 'twilio_sms', primary: false, address: 'fixture-sms', channelId: null }

type Response = { data: unknown; error?: { message: string } | null }
function coordinator(responses: Response[], sendProvider: (input: { destination: typeof meta }) => Promise<unknown>) {
    const writes: Array<{ table: string; values: Record<string, unknown> }> = []
    const db = { from(table: string) {
        const response = responses.shift()
        assert.ok(response, 'Unexpected database request')
        const chain: Record<string, unknown> = {}
        for (const name of ['select', 'eq']) chain[name] = () => chain
        for (const name of ['update', 'upsert']) chain[name] = (values: Record<string, unknown>) => { writes.push({ table, values }); return chain }
        chain.single = chain.maybeSingle = async () => response
        chain.then = (resolve: (value: Response) => unknown) => Promise.resolve(response).then(resolve)
        return chain
    } }
    const bindings = {
        supabaseAdmin: db, console: { error() {} }, sendProvider,
        providerMessageId: (_provider: string, value: { id: string }) => value.id,
        providerLabel: (provider: string) => provider,
        metaWhatsAppFailureIsSafeToRetry: () => true, twilioFailureIsSafeToRetry: () => true,
    }
    const send = new Function(...Object.keys(bindings), `${code}; return sendCommunicationDeliveries`)(...Object.values(bindings))
    return { writes, send: (destinations = [meta, sms]) => send({ workspaceId: 'fixture', relationshipId: 'fixture', messageId: 'fixture', body: 'Synthetic only', destinations }) }
}

test('accepted provider receipt persistence failure remains uncertain across a failed mirror send', async () => {
    const responses: Response[] = [
        { data: null }, { data: { id: 'meta-row' } },
        { data: null, error: { message: 'Receipt write unavailable' } },
        { data: null, error: { message: 'Recovery write unavailable' } },
        { data: null }, { data: { id: 'sms-row' } }, { data: null }, { data: null },
    ]
    const calls: string[] = []
    const run = coordinator(responses, async ({ destination }) => {
        calls.push(destination.provider)
        if (destination.provider === 'twilio_sms') throw new Error('Definite provider rejection')
        return { id: 'accepted-provider-id' }
    })
    const result = await run.send()
    assert.equal(result.status, 'send_uncertain')
    assert.equal(result.results[0].providerMessageId, 'accepted-provider-id')
    assert.equal(result.results[0].safeToRetry, false, 'An accepted send must ignore retry-safe error classifiers')
    assert.ok(run.writes.some(({ values }) => values.status === 'send_uncertain' && values.provider_message_id === 'accepted-provider-id'))
    assert.equal(run.writes.at(-1)?.values.status, 'send_uncertain')
    assert.deepEqual(calls, ['meta_whatsapp', 'twilio_sms'])
    assert.equal(responses.length, 0)
})

test('retry never resends a provider whose earlier sending receipt is unresolved', async () => {
    const responses: Response[] = [
        { data: { id: 'meta-row', status: 'sending', provider_message_id: null } },
        { data: { id: 'sms-row', status: 'send_failed', provider_message_id: null } },
        { data: { id: 'sms-row' } }, { data: null }, { data: null },
    ]
    const calls: string[] = []
    const run = coordinator(responses, async ({ destination }) => { calls.push(destination.provider); return { id: 'sms-accepted' } })
    const result = await run.send()
    assert.deepEqual(calls, ['twilio_sms'])
    assert.equal(result.status, 'send_uncertain', 'A successful mirror destination cannot conceal an uncertain send')
    assert.equal(result.results[0].safeToRetry, false)
    assert.equal(responses.length, 0)
})

test('confirmed receipt plus a definite mirror rejection stays explicitly retryable', async () => {
    const responses: Response[] = [
        { data: { id: 'meta-row', status: 'sent', provider_message_id: 'known-id' } },
        { data: null }, { data: { id: 'sms-row' } }, { data: null }, { data: null },
    ]
    const calls: string[] = []
    const run = coordinator(responses, async ({ destination }) => { calls.push(destination.provider); throw new Error('Definite provider rejection') })
    const result = await run.send()
    assert.equal(result.status, 'partial_sent')
    assert.equal(result.results[0].providerMessageId, 'known-id')
    assert.deepEqual(calls, ['twilio_sms'])
    assert.equal(responses.length, 0)
})
