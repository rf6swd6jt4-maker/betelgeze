// read_team_work_queue against the shared-service-queue schema fixture (in-memory PostgreSQL, synthetic data only).
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {PGlite} from './pglite-fixture.mjs'
import {fixtureSql,migration,seed,id} from './shared-service-queue/fixture.mjs'
const db=new PGlite()
try {
 await db.exec(await fixtureSql());await db.exec(await migration())
 await db.exec("alter table workspaces add column if not exists status text default 'active'")
 await db.exec(await readFile(new URL('../supabase/migrations/20261115190000_team_work_queue.sql',import.meta.url),'utf8'))
 const {w,alice,bob,admin,outsider}=await seed(db)
 const one=async(s,p=[])=>(await db.query(s,p)).rows[0]
 const team=async actor=>(await one('select read_team_work_queue($1,$2) r',[w,actor])).r
 const personal=async user=>(await one("select read_personal_work_queue($1,$2,0,'ready') r",[w,user])).r

 await assert.rejects(team(alice),/Owner or admin required/,'staff cannot read the team queue')
 await assert.rejects(team(id(999)),/Owner or admin required/,'non-members cannot read the team queue')

 const result=await team(admin)
 assert.equal(result.truncated,false)
 assert.ok(!result.people.some(person=>person.userId===admin),'the reader is not part of Team')
 assert.ok(!result.people.some(person=>person.userId===outsider),'people with nothing ready are left out')
 const a=result.people.find(person=>person.userId===alice)
 assert.ok(a,'Alice has ready work');assert.equal(a.name,'Alice')
 const own=await personal(alice)
 assert.equal(a.ready,own.ready,'the count is that person\'s own ready count')
 assert.deepEqual(a.items.map(item=>item.id),own.items.slice(0,4).map(item=>item.id),'same items in the same order as their own queue')
 assert.ok(a.items.length<=4)
 for(const item of a.items){assert.equal('description' in item,false);assert.equal('instructions' in item,false)}

 // Bounded to 25 other members however large the workspace is.
 for(let n=100;n<130;n++){await db.query('insert into auth.users values($1)',[id(n)]);await db.query("insert into workspace_memberships values($1,$2,'staff')",[w,id(n)])}
 assert.equal((await team(admin)).truncated,true)

 // Read-only: nothing changes.
 const before=await db.query('select * from work_items order by id')
 await team(admin)
 assert.deepEqual((await db.query('select * from work_items order by id')).rows,before.rows)
 await db.query("update workspaces set status='archived' where id=$1",[w])
 await assert.rejects(team(admin),/Owner or admin required/,'inactive workspaces are refused')
 console.log('team queue SQL: ok')
} finally { await db.close() }
