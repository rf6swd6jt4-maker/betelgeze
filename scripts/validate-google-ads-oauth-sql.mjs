import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite, repositoryRoot } from './pglite-fixture.mjs'
const db = new PGlite(),w='00000000-0000-4000-8000-000000000001',r='00000000-0000-4000-8000-000000000002'
try {
 await db.exec(`create role anon; create role authenticated; create role service_role bypassrls; create table workspaces(id uuid primary key); create table relationships(workspace_id uuid,id uuid,unique(workspace_id,id)); insert into workspaces values('${w}'); insert into relationships values('${w}','${r}');`)
 await db.exec(await readFile(`${repositoryRoot}/supabase/migrations/20260912100000_google_ads_oauth.sql`,'utf8'))
 for(const role of ['anon','authenticated']) {
  assert.equal((await db.query("select has_table_privilege($1,'google_ads_oauth_attempts','SELECT') allowed",[role])).rows[0].allowed,false)
  assert.equal((await db.query("select has_function_privilege($1,'prepare_google_ads_oauth(uuid,uuid,text,text)','EXECUTE') allowed",[role])).rows[0].allowed,false)
 }
 await db.exec('grant usage on schema public to service_role; set role service_role;')
 const prepare=s=>db.query('select prepare_google_ads_oauth($1,$2,$3,$4)',[w,r,s.repeat(64),'encrypted-context'])
 await prepare('a');await assert.rejects(prepare('b'),/already starting/)
 let changed=await db.query("update google_ads_oauth_attempts set phase='authorizing',browser_hash='browser' where state_hash=$1 and phase='prepared' and expires_at>now() returning state_hash",['a'.repeat(64)]);assert.equal(changed.rows.length,1)
 changed=await db.query("update google_ads_oauth_attempts set phase='authorizing' where state_hash=$1 and phase='prepared' returning state_hash",['a'.repeat(64)]);assert.equal(changed.rows.length,0)
 await db.exec("update google_ads_oauth_attempts set created_at=now()-interval '1 minute',phase='connecting'")
 await assert.rejects(prepare('b'),/already starting/)
 await db.exec("update google_ads_oauth_attempts set expires_at=now()-interval '1 minute'")
 await prepare('b')
 assert.equal((await db.query('select count(*)::int n from google_ads_oauth_attempts')).rows[0].n,1)
 assert.equal((await db.query('select browser_hash,credential_encrypted from google_ads_oauth_attempts')).rows[0].browser_hash,null)
 console.log('PASS: OAuth schema, service-only privileges, single attempt, replay guard, connection lease and expired cleanup')
} finally {await db.close()}
