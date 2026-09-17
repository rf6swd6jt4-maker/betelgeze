import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite, repositoryRoot as root } from './pglite-fixture.mjs'
const db = new PGlite()
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
try {
    await db.exec(`create role authenticated; create role anon; create schema auth;
        create function auth.jwt() returns jsonb language sql stable as $$ select nullif(current_setting('request.jwt.claims',true),'')::jsonb $$;
        create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;
        create table auth.users(id uuid primary key);
        create table auth.sessions(id uuid primary key,user_id uuid,created_at timestamptz default now(),updated_at timestamptz default now(),refreshed_at timestamp,user_agent text,not_after timestamptz);
        create index sessions_user_id_idx on auth.sessions(user_id);
        create table user_profiles(user_id uuid primary key,mfa_reenrollment_required boolean default false);
        create table web_push_subscriptions(user_id uuid,device_id uuid);
        insert into auth.users values('${id(1)}'),('${id(2)}');
        insert into user_profiles(user_id) select id from auth.users;
        insert into auth.sessions(id,user_id,user_agent) values('${id(10)}','${id(1)}','desktop'),('${id(11)}','${id(1)}','phone'),('${id(12)}','${id(2)}','private');`)
    await db.exec(await readFile(`${root}/supabase/migrations/20260917190000_account_devices.sql`,'utf8'))
    const claims = async (user=1,session=10,aal='aal2') => db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:id(user),session_id:id(session),aal,role:'authenticated'})])
    const list = async (device=20) => (await db.query('select account_devices($1,$2,true) result',[id(device),'desktop'])).rows[0].result.devices
    await claims()
    let devices=await list()
    assert.equal(devices.length,2); assert.equal(devices[0].is_current,true)
    assert.equal(devices[0].notifications_enabled,false); assert.equal(devices[1].notifications_enabled,null)
    assert.ok(!JSON.stringify(devices).includes('private'),'other account cannot leak')
    await db.exec(`insert into web_push_subscriptions values('${id(1)}','${id(20)}'),('${id(1)}','${id(21)}');`)
    assert.equal((await list())[0].notifications_enabled,true)
    await claims(1,11); await list(21); await claims()
    assert.ok((await list()).every(d=>d.notifications_enabled),'remote enabled state is associated with real session')
    await db.exec(`delete from web_push_subscriptions where device_id='${id(21)}'`)
    assert.equal((await list()).find(d=>!d.is_current).notifications_enabled,false)
    const before=(await db.query('select last_seen_at from account_session_devices where session_id=$1',[id(10)])).rows[0].last_seen_at
    await list()
    assert.deepEqual((await db.query('select last_seen_at from account_session_devices where session_id=$1',[id(10)])).rows[0].last_seen_at,before,'presence writes are throttled')
    await claims(1,11); await list(20); await claims(); assert.equal((await list()).length,1,'same installation sessions deduplicate')
    await claims(1,12); await assert.rejects(list(),/verified session/)
    await claims(1,10,'aal1'); await assert.rejects(list(),/verified session/)
    await claims(); await db.exec(`update user_profiles set mfa_reenrollment_required=true where user_id='${id(1)}'`); await assert.rejects(list(),/Authenticator/)
    await db.exec(`update user_profiles set mfa_reenrollment_required=false; update auth.sessions set not_after=now()-interval '1 minute' where id='${id(10)}'`); await assert.rejects(list(),/verified session/)
    await db.exec(`delete from auth.sessions where id='${id(10)}'`); await assert.rejects(list(),/verified session/)
    assert.equal((await db.query('select count(*)::int n from account_session_devices where session_id=$1',[id(10)])).rows[0].n,0,'revocation cascades')
    console.log('Account-device SQL: isolation, verified session, revocation, expiry, unknown legacy states, per-device notifications, grouping and throttling passed.')
} finally { await db.close() }
