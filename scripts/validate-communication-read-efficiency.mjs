import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { buildCommunicationReadEfficiencyRelease } from './build-communication-read-efficiency-release.mjs'
import { PGlite } from './pglite-fixture.mjs'
import { baselineReadDefinition, readEfficiencyFixtureIds as ids, readEfficiencyFixtureSql, readEfficiencyMigration, id } from './communication-read-efficiency-fixture.mjs'

const db = new PGlite()
const { w, me, client, native, other } = ids
const cases = []
const claims = (user = me, aal = 'aal2', role = 'authenticated') => db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: user, role, aal })])
const fail = async (operation, code) => {
    await db.exec('savepoint expected_rejection')
    try { await assert.rejects(operation, error => error.code === code) }
    finally { await db.exec('rollback to savepoint expected_rejection; release savepoint expected_rejection') }
}
const contract = async () => (await db.query(`select proacl::text,prosecdef,proconfig,provolatile,pg_get_function_result(oid) result from pg_proc where oid='public.advance_communication_read(uuid,text,uuid,uuid)'::regprocedure`)).rows[0]
try {
    await db.exec(await readEfficiencyFixtureSql())
    const before = await contract()
    const migration = await readEfficiencyMigration()
    await db.exec((await baselineReadDefinition()).replace('public.advance_communication_read(', 'public.baseline_communication_read('))
    const release = await buildCommunicationReadEfficiencyRelease()
    await db.exec(release.install)
    assert.deepEqual(await contract(), before, 'RPC grants, definer, volatility, search path and return type stay unchanged')
    for (const role of ['anon', 'service_role']) assert.equal((await db.query("select has_function_privilege($1,'public.advance_communication_read(uuid,text,uuid,uuid)','execute') allowed", [role])).rows[0].allowed, false)
    assert.equal((await db.query("select has_function_privilege('authenticated','public.advance_communication_read(uuid,text,uuid,uuid)','execute') allowed")).rows[0].allowed, true)
    cases.push('unchanged public RPC contract and grants')
    await db.exec(`create table fixture_cursor_events(kind text,operation text);
        create function fixture_audit_cursor() returns trigger language plpgsql as $$ begin insert into public.fixture_cursor_events values(TG_ARGV[0],TG_OP); return new; end $$;
        create trigger fixture_client_write after insert or update on communication_read_cursors for each row execute function fixture_audit_cursor('client');
        create trigger fixture_native_write after insert or update on workspace_native_read_cursors for each row execute function fixture_audit_cursor('native');`)
    for (const fn of ['baseline_communication_read', 'advance_communication_read']) {
        await db.exec('begin')
        try {
            await claims()
            const read = (kind, conversation, message, workspace = w) => db.query(`select ${fn}($1,$2,$3,$4) value`, [workspace, kind, conversation, message]).then(result => result.rows[0].value)
            const summary = () => db.query('select communication_unread_summary($1) value', [w]).then(result => result.rows[0].value)
            for (const [kind, conversation, messages, cursors, key, base] of [
                ['client', client, 'client_messages', 'communication_read_cursors', 'relationship_id', 100],
                ['native', native, 'workspace_native_messages', 'workspace_native_read_cursors', 'conversation_id', 200],
            ]) {
                await db.exec('truncate fixture_cursor_events')
                const first = await read(kind, conversation, id(base))
                assert.deepEqual(Object.keys(first).sort(), ['lastReadAt', 'lastReadMessageId', 'userId'])
                assert.equal(first.userId, me)
                assert.equal(first.lastReadMessageId, id(base))
                assert.match(first.lastReadAt, /10:00:00\.123456/)
                assert.equal((await db.query('select count(*)::int n from fixture_cursor_events')).rows[0].n, 0, 'legacy wall-clock normalization is returned without a needless write')
                const newer = await read(kind, conversation, id(base + 1))
                assert.equal(newer.lastReadMessageId, id(base + 1))
                assert.match(newer.lastReadAt, /10:00:00\.123457/)
                assert.deepEqual(await read(kind, conversation, id(base)), newer, 'older acknowledgement returns confirmed later position')
                assert.deepEqual(await read(kind, conversation, id(base + 1)), newer, 'duplicate acknowledgement remains identical')
                assert.equal((await db.query('select count(*)::int n from fixture_cursor_events')).rows[0].n, 1, 'one advance produces one receipt event; older/duplicate requests produce none')
                const add = (n, at = '2026-10-09 10:00:00.123457+00') => db.query(kind === 'client'
                    ? `insert into ${messages} values($1,$2,$3,'inbound',$4)`
                    : `insert into ${messages} values($1,$2,$3,'${other}',$4)`, [id(n), w, conversation, at])
                await add(base + 2)
                assert.equal((await summary()).find(row => row.kind === kind).count, 1)
                await db.query(`delete from ${messages} where id=$1`, [id(base + 1)])
                assert.equal((await db.query(`select last_read_message_id from ${cursors} where ${key}=$1 and user_id=$2`, [conversation, me])).rows[0].last_read_message_id, id(base + 1))
                await fail(() => read(kind, conversation, id(base + 1)), '22023')
                assert.equal((await summary()).find(row => row.kind === kind).count, 1, 'deleted historical UUID retains the unread timestamp tie')
                assert.equal((await read(kind, conversation, id(base + 2))).lastReadMessageId, id(base + 2))
                await db.query(`update ${cursors} set last_read_message_id=null where ${key}=$1 and user_id=$2`, [conversation, me])
                await add(base + 3)
                await db.exec('truncate fixture_cursor_events')
                assert.equal((await read(kind, conversation, id(base + 3))).lastReadMessageId, null, 'legacy null cursor covers equal timestamp')
                assert.equal((await db.query('select count(*)::int n from fixture_cursor_events')).rows[0].n, 0)
                await add(base + 4, '2026-10-09 10:00:00.123458+00')
                assert.equal((await read(kind, conversation, id(base + 4))).lastReadMessageId, id(base + 4))
                await db.query(`delete from ${cursors} where ${key}=$1 and user_id=$2`, [conversation, me])
                await db.exec('truncate fixture_cursor_events')
                assert.equal((await read(kind, conversation, id(base + 4))).lastReadMessageId, id(base + 4), 'first cursor inserts correctly')
                assert.deepEqual((await db.query('select operation from fixture_cursor_events')).rows, [{ operation: 'INSERT' }])
            }
            assert.deepEqual(await summary(), [], 'all-read summary stays empty')
            for (const role of ['owner', 'admin', 'staff']) {
                await db.query('update workspace_memberships set role=$1 where workspace_id=$2 and user_id=$3', [role, w, me])
                await read('client', client, id(104)); await read('native', native, id(204))
            }
            await db.query("update workspace_memberships set role='member' where workspace_id=$1 and user_id=$2", [w, me])
            await fail(() => read('client', client, id(104)), '42501')
            await db.query("update workspace_memberships set role='staff' where workspace_id=$1 and user_id=$2", [w, me])
            for (const kind of ['client', 'native']) {
                const conversation = kind === 'client' ? client : native, message = id(kind === 'client' ? 104 : 204)
                for (const [user, aal, role] of [[me, 'aal1', 'authenticated'], [me, null, 'authenticated'], [null, 'aal2', 'authenticated'], [me, 'aal2', 'anon'], [me, 'aal2', 'service_role'], [other, 'aal2', 'authenticated']]) {
                    await claims(user, aal, role); await fail(() => read(kind, conversation, message), '42501')
                }
                await claims()
                await db.query('insert into user_profiles values($1,true)', [me])
                await fail(() => read(kind, conversation, message), '42501')
                await db.exec('delete from user_profiles')
                await fail(() => read(kind, conversation, id(99999)), '22023')
            }
            await fail(() => read('wrong-kind', client, id(104)), '22023')
            await fail(() => read(null, client, id(104)), '22023')
            await fail(() => read('client', id(30), id(104)), '42501')
            await fail(() => read('native', id(40), id(204)), '42501')
            await db.query("insert into workspace_memberships values($1,$2,'staff')", [id(99), me])
            await fail(() => read('client', client, id(104), id(99)), '42501')
            await fail(() => read('native', native, id(204), id(99)), '22023')
            await db.query("insert into workspace_memberships values($1,$2,'staff')", [w, other])
            await claims(other)
            await fail(() => read('client', client, id(104)), '42501')
            await db.query('insert into relationship_client_chat_members values($1,$2,$3)', [w, client, other])
            assert.equal((await read('client', client, id(104))).userId, other, 'explicit client member is authorized')
            await db.exec('delete from relationship_client_chat_members')
            await fail(() => read('client', client, id(104)), '42501')
            await db.query('update relationships set fulfilment_manager_user_id=$1 where id=$2', [other, client])
            await read('client', client, id(104))
            await db.query("update relationships set status='archived' where id=$1", [client])
            await fail(() => read('client', client, id(104)), '42501')
            await claims()
            await db.exec(`insert into workspace_native_conversations values('${id(50)}','${w}','team','${id(60)}');
                insert into workspace_native_messages values('${id(300)}','${w}','${id(50)}','${other}','2026-10-09 12:00:00');`)
            await fail(() => read('native', id(50), id(300)), '42501')
            await db.query('insert into workspace_team_members values($1,$2)', [id(60), me])
            await read('native', id(50), id(300))
            await db.exec('delete from workspace_team_members')
            await fail(() => read('native', id(50), id(300)), '42501')
            await db.query('delete from workspace_native_conversation_participants where conversation_id=$1 and user_id=$2', [native, me])
            await fail(() => read('native', native, id(204)), '42501')
            cases.push(`${fn}: microseconds/ties, first/advance/duplicate/older, historical deletion/null boundaries, exact JSON, unchanged event counts, all read, role/MFA/re-enrollment/workspace/client/direct/team access and revocation`)
        } finally { await db.exec('rollback') }
    }
    await claims()
    const cursor = (await db.query('select last_read_message_id from communication_read_cursors where relationship_id=$1 and user_id=$2', [client, me])).rows[0].last_read_message_id
    await db.exec('begin')
    await db.query('select advance_communication_read($1,$2,$3,$4)', [w, 'client', client, id(101)])
    await db.exec('rollback')
    assert.equal((await db.query('select last_read_message_id from communication_read_cursors where relationship_id=$1 and user_id=$2', [client, me])).rows[0].last_read_message_id, cursor)
    cases.push('transaction rollback leaves cursor unchanged')
    const catalogDigest = async () => (await db.query("select md5(prosrc) digest from pg_proc where oid='public.advance_communication_read(uuid,text,uuid,uuid)'::regprocedure")).rows[0].digest
    const cursorRows = async () => (await db.query('select to_jsonb(c) value from communication_read_cursors c order by workspace_id,relationship_id,user_id')).rows
    const beforeRollback = await cursorRows()
    await db.exec(release.rollback)
    assert.equal(await catalogDigest(), release.manifest.originalMd5)
    assert.deepEqual(await contract(), before)
    assert.deepEqual(await cursorRows(), beforeRollback)
    await db.exec(release.install)
    assert.equal(await catalogDigest(), release.manifest.candidateMd5)
    cases.push('guarded installation and rollback preserve cursor rows and security contract')
    await assert.rejects(() => db.exec(release.install.replace('v_user:=auth.uid();', 'v_user := auth.uid();')), /Migration bytes failed checksum/)
    await db.exec('rollback')
    await db.exec('begin')
    await db.exec("create or replace function public.current_session_is_aal2() returns boolean language sql stable security definer set search_path='' as $$ select true $$;")
    await assert.rejects(() => db.exec(release.install), /Canonical policy differs/)
    await db.exec('rollback')
    await db.exec('begin')
    await db.exec("grant execute on function public.advance_communication_read(uuid,text,uuid,uuid) to anon")
    await assert.rejects(() => db.exec(release.install), /security contract differs/)
    await db.exec('rollback')
    assert.equal(await catalogDigest(), release.manifest.candidateMd5)
    assert.deepEqual(await contract(), before)
    cases.push('installer rejects altered source bytes, policy drift and permission drift atomically')
    console.log(JSON.stringify({ passed: true, migrationSha256: createHash('sha256').update(migration).digest('hex'), cases, evidence: 'isolated PostgreSQL/PGlite; native concurrency and production separately required' }, null, 2))
} finally { await db.close() }
