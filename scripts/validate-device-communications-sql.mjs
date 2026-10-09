import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import { deviceUnreadFixtureSql, deviceUnreadMigration, deviceUnreadIds, id } from './device-unread-sql-fixture.mjs'
import { PGlite } from './pglite-fixture.mjs'

// Exact production SQL in isolated PostgreSQL/WASM; no network or provider calls.
const db = new PGlite()
const { w, me, client, native, other, deviceA, deviceB, sessionA, sessionB, newDevice, newSession } = deviceUnreadIds
const migration = await deviceUnreadMigration()
const cases = []
const claims = async (device = deviceA, user = me, extra = {}) => {
    const session = device === deviceA ? sessionA : device === deviceB ? sessionB : newSession
    await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: user, role: 'authenticated', aal: 'aal2', session_id: session, ...extra })])
}
const summary = async (device = deviceA, workspace = w, includeCursors = true) => (await db.query('select communication_device_unread_summary($1,$2,$3) value', [workspace, device, includeCursors])).rows[0].value
const read = async (device, kind, conversation, message, workspace = w) => (await db.query('select advance_communication_device_read($1,$2,$3,$4,$5) value', [workspace, device, kind, conversation, message])).rows[0].value
const accountRead = async (kind, conversation, message) => (await db.query('select advance_communication_read($1,$2,$3,$4) value', [w, kind, conversation, message])).rows[0].value
const unread = (snapshot, kind, conversation = kind === 'client' ? client : native) => snapshot.conversations.find(row => row.kind === kind && row.conversationId === conversation)?.count ?? 0
const cursor = (snapshot, kind) => snapshot.readCursors.find(row => row.kind === kind)
const deny = async fn => assert.rejects(fn, error => error.code === '42501')
try {
    await db.exec(await deviceUnreadFixtureSql({ includeDeviceMigration: false }))
    const oldDefinitions = (await db.query("select oid::regprocedure::text signature,pg_get_functiondef(oid) definition from pg_proc where proname in ('communication_unread_summary','advance_communication_read','communication_native_inbox') order by proname")).rows
    const startInstall = performance.now()
    await db.exec(migration)
    const installMs = performance.now() - startInstall
    assert.deepEqual((await db.query("select oid::regprocedure::text signature,pg_get_functiondef(oid) definition from pg_proc where proname in ('communication_unread_summary','advance_communication_read','communication_native_inbox') order by proname")).rows, oldDefinitions)
    assert.equal((await db.query('select count(*)::int n from communication_read_cutover_installations')).rows[0].n, 4)
    assert.equal((await db.query('select count(*)::int n from communication_read_cutover_baselines')).rows[0].n, 2)
    for (const role of ['anon', 'service_role', 'authenticated']) {
        for (const signature of ['require_communication_device(uuid,uuid)', 'initialize_communication_device_scope(uuid,uuid,uuid)']) assert.equal((await db.query("select has_function_privilege($1,$2,'EXECUTE') allowed", [role, `public.${signature}`])).rows[0].allowed, false)
        for (const signature of ['communication_device_unread_summary(uuid,uuid,boolean)', 'advance_communication_device_read(uuid,uuid,text,uuid,uuid)']) assert.equal((await db.query("select has_function_privilege($1,$2,'EXECUTE') allowed", [role, `public.${signature}`])).rows[0].allowed, role === 'authenticated')
    }
    for (const table of ['communication_read_cutover_installations', 'communication_read_cutover_baselines', 'communication_device_read_scopes', 'communication_device_read_cursors']) {
        assert.equal((await db.query('select relrowsecurity from pg_class where oid=$1::regclass', [table])).rows[0].relrowsecurity, true)
        assert.equal((await db.query("select has_table_privilege('authenticated',$1,'SELECT,INSERT,UPDATE,DELETE') allowed", [table])).rows[0].allowed, false)
    }
    cases.push('exact migration installs; old RPCs unchanged; RLS/grants and private helpers')
    await claims()
    for (let n = 1; n <= 5; n++) await db.exec(`insert into client_messages values('${id(100 + n)}','${w}','${client}','inbound','2026-10-09 10:00:0${n}.123456+00'); insert into workspace_native_messages values('${id(200 + n)}','${w}','${native}','${other}','2026-10-09 10:00:0${n}.123456+00');`)
    await accountRead('client', client, id(105)); await accountRead('native', native, id(205))
    const snapshot = await summary()
    assert.deepEqual(snapshot.conversations.map(row => row.count).sort(), [5, 5], 'known device seeds frozen cutoff even after another device advances the account')
    assert.equal(cursor(snapshot, 'client').lastReadMessageId, id(100))
    assert.match(cursor(snapshot, 'client').lastReadAt, /10:00:00\.123456/)
    const countsOnly = await summary(deviceA,w,false)
    assert.equal(countsOnly.cursorsIncluded,false); assert.equal(countsOnly.readCursors,undefined); assert.deepEqual(countsOnly.conversations,snapshot.conversations); assert.equal(snapshot.cursorsIncluded,true)
    const acknowledged = await read(deviceA, 'client', client, id(102))
    assert.equal(acknowledged.deviceCursor.lastReadMessageId, id(102)); assert.equal(acknowledged.cursor.lastReadMessageId, id(105))
    assert.equal(acknowledged.deviceCursor.deviceId, deviceA); assert.equal(acknowledged.cursor.deviceId, undefined)
    assert.equal(unread(await summary(), 'client'), 3)
    await claims(deviceB)
    assert.equal(unread(await summary(deviceB), 'client'), 5, 'sleeping known device retains its own frozen initial boundary')
    await read(deviceB, 'client', client, id(105)); assert.equal(unread(await summary(deviceB), 'client'), 0)
    await claims(); assert.equal(unread(await summary(), 'client'), 3)
    await read(deviceA, 'client', client, id(101)); assert.equal(unread(await summary(), 'client'), 3, 'late acknowledgement cannot regress')
    cases.push('sleeping installation cutoff; independent devices; exact device acknowledgement versus farther account receipt; monotonic reads')
    await db.exec(`insert into auth.sessions values('${newSession}','${me}',null); insert into account_session_devices values('${newSession}','${me}','${newDevice}');`)
    await claims(newDevice)
    assert.equal(unread(await summary(newDevice), 'client'), 0, 'new installation seeds current account once')
    await db.exec(`insert into client_messages values('${id(106)}','${w}','${client}','inbound','2026-10-09 10:00:06.123456+00');`)
    await accountRead('client', client, id(106)); assert.equal(unread(await summary(newDevice), 'client'), 1, 'shared cursor no longer moves initialized device')
    // A chat with no frozen baseline remains unread, even before a known device first opens it.
    await db.exec(`insert into relationships values('${id(31)}','${w}','${me}',null,'active'); insert into client_messages values('${id(310)}','${w}','${id(31)}','inbound','2026-10-09 11:00:00');`)
    await accountRead('client', id(31), id(310)); await claims()
    assert.equal(unread(await summary(), 'client', id(31)), 1)
    assert.equal((await db.query('select count(*)::int n from communication_read_cutover_baselines')).rows[0].n, 2)
    cases.push('new installation initializes once; future chats unread; frozen baseline does not move')
    for (const [kind, conversation, table, base] of [['client', client, 'client_messages', 500], ['native', native, 'workspace_native_messages', 600]]) {
        const add = async (n, at = '2026-10-09 12:00:00.123456+00') => db.query(`insert into ${table} values($1,$2,$3,$4,$5)`, [id(n), w, conversation, kind === 'client' ? 'inbound' : other, at])
        await add(base); await add(base + 1); await read(deviceA, kind, conversation, id(base))
        assert.equal(unread(await summary(), kind), 1)
        await db.query(`delete from ${table} where id=$1`, [id(base)])
        assert.equal(unread(await summary(), kind), 1, 'deletion retains UUID timestamp tie')
        await assert.rejects(() => read(deviceA, kind, conversation, id(base)), error => error.code === '22023')
        await read(deviceA, kind, conversation, id(base + 1)); assert.equal(unread(await summary(), kind), 0)
        await add(base + 2, '2026-10-09 12:00:00.123457+00'); assert.equal(unread(await summary(), kind), 1)
        await read(deviceA, kind, conversation, id(base + 2))
        await db.query('update communication_device_read_cursors set last_read_message_id=null where workspace_id=$1 and user_id=$2 and device_id=$3 and kind=$4', [w, me, deviceA, kind])
        await add(base + 3, '2026-10-09 12:00:00.123457+00'); assert.equal(unread(await summary(), kind), 0, 'legacy null retains timestamp-inclusive ordering')
        await add(base + 4, '2026-10-09 12:00:00.123458+00'); assert.equal(unread(await summary(), kind), 1)
    }
    await db.exec(`insert into workspace_native_messages values('${id(700)}','${w}','${native}','${me}','2026-10-09 13:00:00'),('${id(701)}','${w}','${native}',null,'2026-10-09 13:00:00'); insert into client_messages values('${id(702)}','${w}','${client}','outbound','2026-10-09 13:00:00');`)
    assert.equal(unread(await summary(), 'native'), 2); assert.equal(unread(await summary(), 'client'), 1)
    await db.exec(`insert into workspace_native_conversation_visibility values('${native}','${me}','2026-10-09 14:00:00');`)
    assert.equal(unread(await summary(), 'native'), 0)
    cases.push('both kinds: exact microseconds, UUID ties, deleted boundaries/targets, legacy null semantics; system/sent messages; cleared history')
    await assert.rejects(() => summary(deviceB), error => error.code === 'P0002'); await deny(() => summary(deviceA, id(99)))
    await deny(() => read(deviceA, 'client', id(30), id(100))); await deny(() => read(deviceA, 'native', id(40), id(200)))
    await assert.rejects(() => read(deviceA, 'client', client, id(200)), error => error.code === '22023')
    for (const extra of [{ aal: 'aal1' }, { role: 'service_role' }, { role: 'anon' }, { session_id: id(999) }, { session_id: null }]) {
        await claims(deviceA, me, extra); await deny(() => summary()); await deny(() => read(deviceA, 'client', client, id(106)))
    }
    await claims(); await db.exec(`insert into user_profiles values('${me}',true)`); await deny(() => summary())
    await db.exec(`update user_profiles set mfa_reenrollment_required=false; update auth.sessions set not_after=now()-interval '1 second' where id='${sessionA}';`); await deny(() => summary())
    await db.exec(`update auth.sessions set not_after=null where id='${sessionA}'; delete from account_session_devices where session_id='${sessionA}';`); await assert.rejects(() => summary(), error => error.code === 'P0002')
    await db.exec(`insert into account_session_devices values('${sessionA}','${me}','${deviceA}');`)
    await claims(deviceA, other); await deny(() => summary())
    await claims(); await db.exec('set role authenticated'); assert.equal((await summary()).deviceId, deviceA)
    await assert.rejects(() => db.query('select * from communication_device_read_cursors'), error => error.code === '42501')
    await db.exec('reset role')
    // Session deletion denies RPC access without deleting durable installation reads.
    await db.exec(`delete from auth.sessions where id='${sessionA}';`); await deny(() => summary())
    assert.ok((await db.query('select count(*)::int n from communication_device_read_cursors where device_id=$1', [deviceA])).rows[0].n > 0)
    await db.exec(`insert into auth.sessions values('${sessionA}','${me}',null); insert into account_session_devices values('${sessionA}','${me}','${deviceA}');`)
    cases.push('AAL2/MFA; live/revoked/expired session; bound device; account/workspace/conversation/message isolation; authenticated RPC and denied direct table access')
    // Failure rolls scope marker and seed back together, preserving retryability.
    await db.exec(`insert into auth.sessions values('${id(90)}','${me}',null); insert into account_session_devices values('${id(90)}','${me}','${id(91)}');`)
    await db.exec('begin')
    await claims(deviceA, me, { session_id: id(90) }); await summary(id(91)); await db.exec('rollback')
    assert.equal((await db.query('select count(*)::int n from communication_device_read_scopes where device_id=$1',[id(91)])).rows[0].n,0)
    await claims(deviceA, me, { session_id: id(90) }); await summary(id(91)); assert.equal((await db.query('select count(*)::int n from communication_device_read_scopes where device_id=$1',[id(91)])).rows[0].n,1)
    await claims(); cases.push('initialization rollback removes marker and seed; retry initializes once')
    const benchmarks = []
    const stats = times => { const s = [...times].sort((a, b) => a - b); return { samples: s.length, medianMs: s[Math.floor(s.length / 2)], p95Ms: s[Math.ceil(s.length * .95) - 1], minMs: s[0], maxMs: s.at(-1) } }
    const explainTime = async (query, params) => (await db.query(`explain (analyze,format json) ${query}`, params)).rows[0]['QUERY PLAN'][0]['Execution Time']
    for (const chats of [20, 100]) {
        const bw = id(1000 + chats)
        await db.exec(`
            insert into workspaces values('${bw}'); insert into workspace_memberships values('${bw}','${me}','staff');
            insert into relationships select md5('${bw}:c:'||n)::uuid,'${bw}','${me}',null,'active' from generate_series(1,${chats}) n;
            insert into workspace_native_conversations select md5('${bw}:n:'||n)::uuid,'${bw}','direct',null from generate_series(1,${chats}) n;
            insert into workspace_native_conversation_participants select id,'${me}' from workspace_native_conversations where workspace_id='${bw}';
            insert into client_messages select md5(r.id::text||':'||n)::uuid,'${bw}',r.id,'inbound',timestamptz '2026-01-01'+n*interval '1 second' from relationships r cross join generate_series(1,1000) n where r.workspace_id='${bw}';
            insert into workspace_native_messages select md5(c.id::text||':'||n)::uuid,'${bw}',c.id,'${other}',timestamptz '2026-01-01'+n*interval '1 second' from workspace_native_conversations c cross join generate_series(1,1000) n where c.workspace_id='${bw}';
            insert into communication_read_cursors select workspace_id,relationship_id,'${me}',id,created_at from client_messages where workspace_id='${bw}' and created_at=timestamptz '2026-01-01'+interval '950 seconds';
            insert into workspace_native_read_cursors select workspace_id,conversation_id,'${me}',id,created_at from workspace_native_messages where workspace_id='${bw}' and created_at=timestamptz '2026-01-01'+interval '950 seconds';
            analyze;
        `)
        // Known A has no frozen boundaries for this new workspace, so cap each range at 100.
        await claims(); const capped = await summary(deviceA,bw,false); assert.ok(capped.conversations.every(row => row.count === 100))
        // New installation uses matched account boundaries, seeded exactly once.
        await claims(newDevice)
        const initStart = performance.now(); const initial = await summary(newDevice, bw); const firstInitMs = performance.now() - initStart
        assert.equal(initial.conversations.length, chats * 2); assert.ok(initial.conversations.every(row => row.count === 50))
        const queries = [['global', 'select communication_unread_summary($1)', [bw]], ['device', 'select communication_device_unread_summary($1,$2,false)', [bw, newDevice]], ['deviceRecovery', 'select communication_device_unread_summary($1,$2,true)', [bw,newDevice]]]
        const summaryTimes = { global: [], device: [], deviceRecovery: [] }
        for (let n = 0; n < 48; n++) for (const [name, query, params] of n % 2 ? [...queries].reverse() : queries) {
            const time = await explainTime(query, params); if (n >= 8) summaryTimes[name].push(time)
        }
        const baselinePayload = (await db.query('select communication_unread_summary($1) value', [bw])).rows[0].value
        const target = (await db.query('select id,relationship_id from client_messages where workspace_id=$1 order by created_at desc limit 1', [bw])).rows[0]
        const reset = async () => db.query(`with global_reset as (update communication_read_cursors set last_read_at='2026-01-01',last_read_message_id=null where workspace_id=$1 and relationship_id=$2 and user_id=$3) update communication_device_read_cursors set last_read_at='2026-01-01',last_read_message_id=null where workspace_id=$1 and conversation_id=$2 and user_id=$3 and device_id=$4`, [bw, target.relationship_id, me, newDevice])
        const writes = [['global', 'select advance_communication_read($1,$2,$3,$4)', [bw, 'client', target.relationship_id, target.id]], ['device', 'select advance_communication_device_read($1,$2,$3,$4,$5)', [bw, newDevice, 'client', target.relationship_id, target.id]]]
        const writeTimes = { global: [], device: [] }
        for (let n = 0; n < 68; n++) for (const [name, query, params] of n % 2 ? [...writes].reverse() : writes) {
            await reset(); const time = await explainTime(query, params); if (n >= 8) writeTimes[name].push(time)
        }
        const indexedPlan = (await db.query(`explain (analyze,format json) select id from client_messages where relationship_id=$1 and direction='inbound' and (created_at,id)>('2026-01-01 00:15:50', 'ffffffff-ffff-ffff-ffff-ffffffffffff') order by created_at desc,id desc limit 100`, [target.relationship_id])).rows[0]['QUERY PLAN']
        assert.match(JSON.stringify(indexedPlan), /Index Scan|Bitmap Index Scan/)
        benchmarks.push({ conversations: chats * 2, messages: chats * 2000, initializedCursorRows: initial.readCursors.length, firstInitMs: Math.round(firstInitMs * 100) / 100, summary: { global: stats(summaryTimes.global), device: stats(summaryTimes.device), deviceRecovery: stats(summaryTimes.deviceRecovery) }, readWrite: { global: stats(writeTimes.global), device: stats(writeTimes.device) }, jsonBytes: { global: Buffer.byteLength(JSON.stringify(baselinePayload)), device: Buffer.byteLength(JSON.stringify(await summary(newDevice,bw,false))), deviceRecovery: Buffer.byteLength(JSON.stringify(initial)) }, boundedRangeUsesExistingIndex: true })
    }
    const payloadCohorts = []
    for (const chats of [100, 1000]) {
        const pw = id(5000 + chats)
        await db.exec(`insert into workspaces values('${pw}'); insert into workspace_memberships values('${pw}','${me}','staff');
            insert into relationships select md5('${pw}:allread:'||n)::uuid,'${pw}','${me}',null,'active' from generate_series(1,${chats}) n;
            insert into communication_read_cursors select workspace_id,id,'${me}',md5(id::text||':deleted-boundary')::uuid,'2026-01-01' from relationships where workspace_id='${pw}';`)
        await claims(newDevice); const payload = await summary(newDevice,pw)
        assert.equal(payload.readCursors.length,chats); assert.deepEqual(payload.conversations,[])
        const compact = { deviceId:payload.deviceId,conversations:payload.conversations,readCursors:payload.readCursors.map(({kind,conversationId,lastReadAt,lastReadMessageId})=>({kind,conversationId,lastReadAt,lastReadMessageId})) }
        const bytes = value => ({ json:Buffer.byteLength(JSON.stringify(value)), gzip:gzipSync(JSON.stringify(value)).length })
        const allReadTimes = { global: [], device: [], deviceRecovery: [] }
        const variants = [['global','select communication_unread_summary($1)',[pw]],['device','select communication_device_unread_summary($1,$2,false)',[pw,newDevice]],['deviceRecovery','select communication_device_unread_summary($1,$2,true)',[pw,newDevice]]]
        for (let n=0;n<34;n++) for (const [name,query,params] of n%2 ? [...variants].reverse() : variants) {
            const time = await explainTime(query,params); if(n>=4) allReadTimes[name].push(time)
        }
        payloadCohorts.push({ conversations:chats,allRead:true,history:'deleted historical boundaries, no retained messages',global:bytes([]),device:bytes(await summary(newDevice,pw,false)),deviceRecovery:bytes(payload),compactDeviceRecovery:bytes(compact),summary:{global:stats(allReadTimes.global),device:stats(allReadTimes.device),deviceRecovery:stats(allReadTimes.deviceRecovery)} })
    }
    const functions = (await db.query("select oid::regprocedure::text signature,md5(regexp_replace(pg_get_functiondef(oid),'\\s+',' ','g')) normalizedMd5 from pg_proc where proname in ('require_communication_device','initialize_communication_device_scope','communication_device_unread_summary','advance_communication_device_read') order by proname")).rows
    console.log(JSON.stringify({ passed: true, migrationSha256: createHash('sha256').update(migration).digest('hex'), installMs: Math.round(installMs), cases, functions, benchmarks, payloadCohorts, evidence: 'Exact SQL, isolated PostgreSQL/PGlite. Execution Time excludes client/network. First init is fixture wall time. No production load, provider delivery, browser or physical-device evidence; PGlite serializes calls, so cross-connection lock behavior requires real PostgreSQL rehearsal.' }, null, 2))
} finally { await db.close() }
