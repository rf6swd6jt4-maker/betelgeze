import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { PGlite } from './pglite-fixture.mjs'
import { baselineReadDefinition, readEfficiencyFixtureIds as ids, readEfficiencyFixtureSql, readEfficiencyMigration, id } from './communication-read-efficiency-fixture.mjs'

// Matched database execution only. Resets/seeding stay outside the measured call.
// The unchanged second baseline establishes fixture/clock variation; it is not a
// different implementation or an allowance for regressions in another action.
const { w, me, client, native, other } = ids
const migration = await readEfficiencyMigration(), baseline = await baselineReadDefinition()
const variants = ['baseline_read', 'baseline_control_read', 'advance_communication_read']
const sampleCount = 240, warmups = 16
const statistics = values => {
    const sorted = [...values].sort((a, b) => a - b)
    return { n: sorted.length, median: sorted[Math.floor(sorted.length / 2)], p95: sorted[Math.ceil(sorted.length * .95) - 1], min: sorted[0], max: sorted.at(-1) }
}
const results = []
for (const conversations of [1, 1000]) {
    const db = new PGlite()
    const setClaims = value => db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify(value)])
    const timed = async (name, args) => (await db.query(`explain (analyze,format json) select public.${name}($1,$2,$3,$4)`, args)).rows[0]['QUERY PLAN'][0]['Execution Time']
    try {
        await db.exec(await readEfficiencyFixtureSql())
        for (const name of variants.slice(0, 2)) await db.exec(baseline.replace('public.advance_communication_read(', `public.${name}(`))
        await db.exec(migration)
        await setClaims({ sub: me, role: 'authenticated', aal: 'aal2' })
        if (conversations > 1) await db.exec(`
            insert into relationships select md5('background-client:'||n)::uuid,'${w}','${me}',null,'active' from generate_series(2,${conversations}) n;
            insert into workspace_native_conversations select md5('background-native:'||n)::uuid,'${w}','direct',null from generate_series(2,${conversations}) n;
            insert into workspace_native_conversation_participants select id,'${me}' from workspace_native_conversations on conflict do nothing;
            insert into communication_read_cursors select '${w}',id,'${me}',null,'2026-01-01' from relationships on conflict do nothing;
            insert into workspace_native_read_cursors select '${w}',id,'${me}',null,'2026-01-01' from workspace_native_conversations on conflict do nothing;`)
        await db.exec(`
            insert into client_messages select md5('client-message:'||n)::uuid,'${w}','${client}','inbound',timestamptz '2026-01-01'+n*interval '1 second' from generate_series(1,10000)n;
            insert into workspace_native_messages select md5('native-message:'||n)::uuid,'${w}','${native}','${other}',timestamptz '2026-01-01'+n*interval '1 second' from generate_series(1,10000)n;
            insert into client_messages values('${id(102)}','${w}','${client}','inbound','2026-10-09 10:00:00.123457+00');
            insert into workspace_native_messages values('${id(202)}','${w}','${native}','${other}','2026-10-09 10:00:00.123457+00');
            analyze;`)
        for (const kind of ['client', 'native']) for (const scenario of ['first', 'advance', 'older', 'duplicate', 'timestamp-tie']) {
            const base = kind === 'client' ? 100 : 200, conversation = kind === 'client' ? client : native
            const table = kind === 'client' ? 'communication_read_cursors' : 'workspace_native_read_cursors', key = kind === 'client' ? 'relationship_id' : 'conversation_id'
            const prior = id(base + (scenario === 'advance' ? 0 : 1)), target = id(base + (scenario === 'older' ? 0 : scenario === 'timestamp-tie' ? 2 : 1))
            const args = [w, kind, conversation, target]
            const samples = Object.fromEntries(variants.map(name => [name, []]))
            for (let n = 0; n < sampleCount + warmups; n++) for (const name of n % 2 ? [...variants].reverse() : variants) {
                if (scenario === 'first') await db.query(`delete from ${table} where ${key}=$1 and user_id=$2`, [conversation, me])
                else await db.query(`insert into ${table}(workspace_id,${key},user_id,last_read_message_id,last_read_at) values($1,$2,$3,$4,'2026-10-09 12:00:00')
                    on conflict(${kind === 'client' ? 'workspace_id,' : ''}${key},user_id) do update set last_read_message_id=excluded.last_read_message_id,last_read_at=excluded.last_read_at`, [w, conversation, me, prior])
                const elapsed = await timed(name, args)
                if (n >= warmups) samples[name].push(elapsed)
            }
            results.push({ conversations, messagesPerTarget: 10003, kind, scenario, latencyMs: Object.fromEntries(Object.entries(samples).map(([name, values]) => [name, statistics(values)])) })
        }
        // The unchanged all-read summary is checked for result/payload identity,
        // not presented as an optimization. No summaries or indexes are replaced.
        await db.query('select advance_communication_read($1,$2,$3,$4)', [w, 'client', client, id(102)])
        await db.query('select advance_communication_read($1,$2,$3,$4)', [w, 'native', native, id(202)])
        assert.deepEqual((await db.query('select communication_unread_summary($1) value', [w])).rows[0].value, [])
        if (conversations === 1) {
            for (const name of variants) await db.exec(`create function public.rejection_${name}(w uuid,k text,c uuid,m uuid) returns text language plpgsql as $$ begin perform public.${name}(w,k,c,m); return 'ok'; exception when others then return sqlstate; end $$;`)
            for (const [scenario, claims, kind, conversation, message, code] of [
                ['aal1', { sub: me, role: 'authenticated', aal: 'aal1' }, 'client', client, id(101), '42501'],
                ['mfa-reenrollment', { sub: me, role: 'authenticated', aal: 'aal2' }, 'client', client, id(101), '42501'],
                ['nonmember', { sub: other, role: 'authenticated', aal: 'aal2' }, 'client', client, id(101), '42501'],
                ['forbidden-client', { sub: me, role: 'authenticated', aal: 'aal2' }, 'client', id(30), id(101), '42501'],
                ['forbidden-native', { sub: me, role: 'authenticated', aal: 'aal2' }, 'native', id(40), id(201), '42501'],
                ['missing-target', { sub: me, role: 'authenticated', aal: 'aal2' }, 'client', client, id(99999), '22023'],
                ['invalid-kind', { sub: me, role: 'authenticated', aal: 'aal2' }, 'invalid', client, id(101), '22023'],
                ['anon', { sub: me, role: 'anon', aal: 'aal2' }, 'client', client, id(101), '42501'],
            ]) {
                await setClaims(claims)
                await db.exec('delete from user_profiles')
                if (scenario === 'mfa-reenrollment') await db.query('insert into user_profiles values($1,true)', [me])
                const samples = Object.fromEntries(variants.map(name => [name, []])), args = [w, kind, conversation, message]
                for (const name of variants) assert.equal((await db.query(`select rejection_${name}($1,$2,$3,$4) code`, args)).rows[0].code, code)
                for (let n = 0; n < sampleCount + warmups; n++) for (const name of n % 2 ? [...variants].reverse() : variants) {
                    const elapsed = await timed(`rejection_${name}`, args)
                    if (n >= warmups) samples[name].push(elapsed)
                }
                results.push({ conversations, kind, scenario, latencyMs: Object.fromEntries(Object.entries(samples).map(([name, values]) => [name, statistics(values)])) })
            }
        }
    } finally { await db.close() }
}
console.log(JSON.stringify({ migrationSha256: createHash('sha256').update(migration).digest('hex'), baselineSha256: createHash('sha256').update(baseline).digest('hex'), sampleCount, results,
    limitations: ['isolated PostgreSQL/PGlite, warm database execution only', 'not HTTP, production load, concurrency or physical-device evidence', 'unaltered summary returns the same all-read payload; no summary speed claim', 'denial timings include the same exception-catching wrapper for every arm'] }, null, 2))
