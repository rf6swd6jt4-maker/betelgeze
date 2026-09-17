import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite, repositoryRoot as root } from './pglite-fixture.mjs'
const db = new PGlite()
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
try {
    await db.exec(`create role service_role; create role authenticated; create role anon; create schema auth;
        create function auth.jwt() returns jsonb language sql stable as $$ select nullif(current_setting('request.jwt.claims',true),'')::jsonb $$;
        create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;
        create table auth.users(id uuid primary key);
        create table auth.sessions(id uuid primary key,user_id uuid,created_at timestamptz default now(),updated_at timestamptz default now(),refreshed_at timestamp,user_agent text,not_after timestamptz);
        create index sessions_user_id_idx on auth.sessions(user_id);
        create table user_profiles(user_id uuid primary key,mfa_reenrollment_required boolean default false);
        create table web_push_subscriptions(user_id uuid,device_id uuid,id uuid primary key default gen_random_uuid(),endpoint text unique,p256dh text,auth text,user_agent text,updated_at timestamptz default now(),failure_count int default 0);
        insert into auth.users values('${id(1)}'),('${id(2)}');
        insert into user_profiles(user_id) select id from auth.users;
        insert into auth.sessions(id,user_id,user_agent) values('${id(10)}','${id(1)}','desktop'),('${id(11)}','${id(1)}','phone'),('${id(12)}','${id(2)}','private');`)
    await db.exec(await readFile(`${root}/supabase/migrations/20260917190000_account_devices.sql`,'utf8'))
    await db.exec(await readFile(`${root}/supabase/migrations/20260917211000_account_devices_signin_order.sql`,'utf8'))
    await db.exec(await readFile(`${root}/supabase/migrations/20260917220000_last_account_push.sql`,'utf8'))
    await db.exec(`update auth.sessions set created_at='2026-09-17 10:00:00Z' where id='${id(10)}'; update auth.sessions set created_at='2026-09-17 09:00:00Z' where id='${id(11)}';`)
    const claims = async (user=1,session=10,aal='aal2') => db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:id(user),session_id:id(session),aal,role:'authenticated'})])
    const list = async (device=20) => (await db.query('select account_devices($1,$2,true) result',[id(device),'desktop'])).rows[0].result.devices
    await claims()
    let devices=await list()
    assert.equal(devices.length,2); assert.equal(devices[0].is_current,true)
    assert.equal(devices[0].notifications_enabled,false); assert.equal(devices[1].notifications_enabled,null)
    assert.ok(!JSON.stringify(devices).includes('private'),'other account cannot leak')
    await db.exec(`insert into web_push_subscriptions(user_id,device_id) values('${id(1)}','${id(20)}'),('${id(1)}','${id(21)}');`)
    assert.equal((await list())[0].notifications_enabled,true)
    await claims(1,11); await list(21); await claims()
    assert.ok((await list()).every(d=>d.notifications_enabled),'remote enabled state is associated with real session')
    await db.exec(`delete from web_push_subscriptions where device_id='${id(21)}'`)
    assert.equal((await list()).find(d=>!d.is_current).notifications_enabled,false)
    const before=(await db.query('select last_seen_at from account_session_devices where session_id=$1',[id(10)])).rows[0].last_seen_at
    await list()
    assert.deepEqual((await db.query('select last_seen_at from account_session_devices where session_id=$1',[id(10)])).rows[0].last_seen_at,before,'presence writes are throttled')
    await claims(1,11); await list(20); await claims(); assert.equal((await list()).length,1,'same installation sessions deduplicate')
    // Last seen and the current session must not displace a newer sign-in.
    await db.exec(`insert into auth.sessions(id,user_id,created_at,updated_at,user_agent) values('${id(13)}','${id(1)}','2026-09-17 11:00:00Z','2026-09-17 11:00:00Z','new phone');`)
    assert.equal((await list())[0].id,id(13)); assert.equal((await list())[1].is_current,true)
    // A new verified account takes over this enabled installation. Older
    // foreground tabs and reconciliation cannot reclaim it. Other devices stay.
    await claims(2,12); await list(20)
    assert.equal((await db.query('select user_id from web_push_subscriptions where device_id=$1',[id(20)])).rows[0].user_id,id(2))
    await claims(); await list(20)
    assert.equal((await db.query('select user_id from web_push_subscriptions where device_id=$1',[id(20)])).rows[0].user_id,id(2))
    await assert.rejects(db.query('select register_chat_push_subscription($1,$2,$3,$4,$5)',[id(1),id(20),'https://push.test/stale','key','auth']),/newer account/)
    await db.query('select register_chat_push_subscription($1,$2,$3,$4,$5)',[id(2),id(20),'https://push.test/current','key','auth'])
    // Quitting/expiry does not remove saved push; no session is needed to send.
    await db.exec(`update auth.sessions set not_after=now()-interval '1 minute' where id='${id(12)}'`)
    assert.equal((await db.query('select count(*)::int n from web_push_subscriptions where user_id=$1',[id(2)])).rows[0].n,1)
    await db.exec(`delete from auth.sessions where id='${id(12)}'`)
    await claims(); await list(20)
    assert.equal((await db.query('select user_id from web_push_subscriptions where device_id=$1',[id(20)])).rows[0].user_id,id(2),'expiry cleanup cannot hand push back to an older account')
    await assert.rejects(db.query('select register_chat_push_subscription($1,$2,$3,$4,$5)',[id(1),id(20),'https://push.test/stale','key','auth']),/newer account/)
    await db.exec(`insert into auth.sessions(id,user_id) values('${id(12)}','${id(2)}')`)
    // Explicit off/logout deletion must not be undone by a presence observation.
    await db.query('select revoke_chat_push_device($1)',[id(20)])
    await db.exec(`update auth.sessions set not_after=null where id='${id(12)}'`)
    await claims(2,12); await list(20)
    assert.equal((await db.query('select count(*)::int n from web_push_subscriptions where device_id=$1',[id(20)])).rows[0].n,0)
    await assert.rejects(db.query('select register_chat_push_subscription($1,$2,$3,$4,$5,null,true)',[id(2),id(20),'https://push.test/current','key','auth']),/explicitly enabled/)
    await claims(1,12); await assert.rejects(list(),/verified session/)
    await claims(1,10,'aal1'); await assert.rejects(list(),/verified session/)
    await claims(); await db.exec(`update user_profiles set mfa_reenrollment_required=true where user_id='${id(1)}'`); await assert.rejects(list(),/Authenticator/)
    await db.exec(`update user_profiles set mfa_reenrollment_required=false; update auth.sessions set not_after=now()-interval '1 minute' where id='${id(10)}'`); await assert.rejects(list(),/verified session/)
    await db.exec(`delete from auth.sessions where id='${id(10)}'`); await assert.rejects(list(),/verified session/)
    assert.equal((await db.query('select count(*)::int n from account_session_devices where session_id=$1',[id(10)])).rows[0].n,0,'revocation cascades')
    // Revised installation-wide consent contract, applied after proving the
    // previous baseline. Real function bodies, not a reimplementation.
    await db.exec(`alter table web_push_subscriptions add constraint web_push_subscriptions_user_id_fkey foreign key(user_id) references auth.users(id) on delete cascade;
      create table chat_push_deliveries(subscription_id uuid,user_id uuid,status text,lease_token uuid,lease_until timestamptz);
      insert into auth.sessions(id,user_id,created_at) values('${id(50)}','${id(1)}',now()),('${id(51)}','${id(2)}',now()+interval '1 second'),('${id(52)}','${id(1)}',now()+interval '2 seconds');`)
    await db.exec(await readFile(`${root}/supabase/migrations/20260917230000_installation_push_consent.sql`,'utf8'))
    await claims(1,50); await list(40)
    await db.query('select register_chat_push_subscription($1,$2,$3,$4,$5)',[id(1),id(40),'https://push.test/installation','key','auth'])
    const subscription=(await db.query('select id from web_push_subscriptions where device_id=$1',[id(40)])).rows[0].id
    await db.query('insert into chat_push_deliveries(subscription_id,user_id,status,lease_token,lease_until) values($1,$2,$3,null,null)',[subscription,id(1),'pending'])
    await db.query('select pause_chat_push_device($1)',[id(40)])
    let status=(await db.query('select chat_push_device_status($1) value',[id(40)])).rows[0].value
    assert.equal(status.enabled,true);assert.equal(status.subscription.endpoint,'https://push.test/installation')
    assert.equal((await db.query('select user_id from web_push_subscriptions where id=$1',[subscription])).rows[0].user_id,null)
    assert.equal((await db.query('select status from chat_push_deliveries')).rows[0].status,'revoked')
    await list(40)
    assert.equal((await db.query('select user_id from web_push_subscriptions where id=$1',[subscription])).rows[0].user_id,null,'late presence must not resume a logged-out session')
    await assert.rejects(db.query('select register_chat_push_subscription($1,$2,$3,$4,$5,null,true)',[id(1),id(40),'https://push.test/installation','key','auth']),/newer account/)
    await claims(2,51);await list(40)
    assert.equal((await db.query('select user_id from web_push_subscriptions where id=$1',[subscription])).rows[0].user_id,id(2),'new login resumes existing enrollment')
    await claims(1,50);assert.equal((await list(40)).find(d=>d.is_current).notifications_enabled,true,'all accounts see installation-wide enabled state')
    await db.query('insert into chat_push_deliveries(subscription_id,user_id,status,lease_token,lease_until) values($1,$2,$3,null,null)',[subscription,id(2),'pending'])
    await claims(1,52);await list(40)
    assert.ok((await db.query('select status from chat_push_deliveries')).rows.every(d=>d.status==='revoked'),'A-B-A cannot revive old jobs')
    await db.query('select revoke_chat_push_device($1,$2)',[id(40),id(2)])
    assert.equal((await db.query('select chat_push_device_status($1) value',[id(40)])).rows[0].value.enabled,false,'off is global, independent of recipient')
    await list(40);assert.equal((await db.query('select count(*)::int n from web_push_subscriptions where device_id=$1',[id(40)])).rows[0].n,0)
    await assert.rejects(db.query('select register_chat_push_subscription($1,$2,$3,$4,$5,null,true)',[id(1),id(40),'https://push.test/installation','key','auth']),/explicitly enabled/)
    await db.query('select register_chat_push_subscription($1,$2,$3,$4,$5)',[id(1),id(40),'https://push.test/installation','key','auth'])
    await db.query('delete from web_push_subscriptions where device_id=$1',[id(40)])
    assert.equal((await db.query('select chat_push_device_status($1) value',[id(40)])).rows[0].value.enabled,true,'provider expiry does not erase consent')
    await db.query('select register_chat_push_subscription($1,$2,$3,$4,$5,null,true)',[id(1),id(40),'https://push.test/replacement','new-key','new-auth'])
    // Most recent observed visits win even with old sign-in creation times.
    await db.exec(`update auth.sessions set created_at=now()-interval '1 year' where id='${id(50)}'; update account_session_devices set last_seen_at=now()-interval '1 day' where session_id='${id(52)}'`)
    await claims(1,50);const recent=await list(41)
    assert.equal(recent[0].id,id(50));assert.equal(recent[0].is_current,true)
    await claims(1,52);await list(42)
    await db.query('select register_chat_push_subscription($1,$2,$3,$4,$5,null,true,true)',[id(1),id(42),'https://push.test/legacy-browser','key','auth'])
    await db.query('select revoke_chat_push_device($1,$2)',[id(42),id(1)])
    await assert.rejects(db.query('select register_chat_push_subscription($1,$2,$3,$4,$5,null,true,true)',[id(1),id(42),'https://push.test/legacy-browser','key','auth']),/explicitly enabled/,'off racing unknown-state recovery must win')
    await db.query('select pause_chat_push_device($1)',[id(44)])
    await claims(1,50);await list(44)
    assert.equal((await db.query('select logged_out from chat_push_device_owners where device_id=$1',[id(44)])).rows[0].logged_out,true,'late first observation cannot undo logout')
    await assert.rejects(db.query('select register_chat_push_subscription($1,$2,$3,$4,$5)',[id(1),id(44),'https://push.test/late-first-observation','key','auth']),/newer account/)
    console.log('Installation consent SQL: global setting, logout pause, resumed login, stale sessions, A-B-A jobs, endpoint repair and last-visit ordering passed.')
    console.log('Account-device SQL: isolation, verified session, revocation, expiry, unknown legacy states, per-device notifications, grouping and throttling passed.')
} finally { await db.close() }
