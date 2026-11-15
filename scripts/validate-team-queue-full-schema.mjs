// read_team_work_queue against the REAL combined schema (every committed migration replayed in memory), so the personal
// queue read it calls is the current one, including every later rewrite. No credentials, no Supabase connection.
import assert from 'node:assert/strict'
import { replayFullSchema } from './assignment-full-schema/replay.mjs'

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const ws = id(1), owner = id(2), alice = id(3), bob = id(4), idle = id(5)
const { db } = await replayFullSchema()
const q = async (sql, args = []) => (await db.query(sql, args)).rows
let checks = 0
const pass = label => { checks++; console.log(`PASS ${checks}: ${label}`) }

try {
    await db.exec('set session_replication_role = replica')
    for (const [user, name] of [[owner, 'owner'], [alice, 'alice'], [bob, 'bob'], [idle, 'idle']]) await q("insert into auth.users(id,email,raw_user_meta_data) values($1,$2,jsonb_build_object('username',$3::text))", [user, `${name}@example.invalid`, name])
    await q("insert into workspaces(id,name,slug) values($1,'Synthetic','synthetic')", [ws])
    // Alice and Bob are admins so the fixture needs no service-access rows to see their own work; `idle` is plain staff.
    await q("insert into workspace_memberships(workspace_id,user_id,role) values($1,$2,'owner'),($1,$3,'admin'),($1,$4,'admin'),($1,$5,'staff')", [ws, owner, alice, bob, idle])
    let serial = 100
    const work = async (title, user, status = 'todo') => { const item = id(serial++); await q('insert into work_items(id,workspace_id,title,status,execution_owner_id,description) values($1,$2,$3,$4,$5,$6)', [item, ws, title, status, user, 'Private detail']); return item }
    const aliceItems = []
    for (let n = 1; n <= 6; n++) aliceItems.push(await work(`Alice task ${n}`, alice, n === 3 ? 'doing' : 'todo'))
    const bobItem = await work('Bob task', bob)
    await work('Finished task', bob, 'done')
    await work('Owner task', owner)
    await db.exec('set session_replication_role = origin')

    const team = async actor => (await q('select read_team_work_queue($1,$2) r', [ws, actor]))[0].r
    const personal = async user => (await q("select read_personal_work_queue($1,$2,0,'ready') r", [ws, user]))[0].r

    await assert.rejects(team(idle), /Owner or admin required/); pass('staff are refused')
    await assert.rejects(team(id(999)), /Owner or admin required/); pass('non-members are refused')

    const result = await team(owner)
    assert.deepEqual(result.people.map(person => person.userId).sort(), [alice, bob].sort()); pass('only other members with ready work are listed')
    const a = result.people.find(person => person.userId === alice), own = await personal(alice)
    assert.equal(own.ready, 6); assert.equal(a.ready, 6)
    assert.deepEqual(a.items.map(item => item.id), own.items.slice(0, 4).map(item => item.id)); pass("each person's rows and count match their own current queue, in its order")
    assert.equal(a.items[0].status, 'doing'); pass('work in progress leads, as in the personal queue')
    assert.ok(a.items.every(item => !('description' in item) && !('instructions' in item))); pass('descriptions and instructions are not returned')
    assert.deepEqual(result.people.find(person => person.userId === bob).items.map(item => item.id), [bobItem]); pass('finished work is not listed')
    assert.equal(result.truncated, false)
    assert.ok(typeof a.name === 'string' && a.name.length > 0); pass('every person has a display name')

    const before = await q('select id, status, updated_at from work_items order by id')
    await team(owner)
    assert.deepEqual(await q('select id, status, updated_at from work_items order by id'), before); pass('the read changes nothing')
    console.log(`team queue on the full schema: ${checks} checks passed`)
} finally { await db.close() }
