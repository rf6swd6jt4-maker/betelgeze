// workspace_needs_attention against the REAL combined schema (every committed migration replayed in memory).
// No credentials, no Supabase connection. Fixture rows are placed with triggers off; the read runs normally.
import assert from 'node:assert/strict'
import { replayFullSchema } from './assignment-full-schema/replay.mjs'

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const ws = id(1), owner = id(2), staff = id(3), gone = id(4)
const service = id(20), revision = id(21)
const active = id(30), archived = id(31), quiet = id(32)
let serial = 100

const { db } = await replayFullSchema()
const q = async (sql, args = []) => (await db.query(sql, args)).rows
let checks = 0
const pass = label => { checks++; console.log(`PASS ${checks}: ${label}`) }
const days = n => new Date(Date.now() - n * 86_400_000).toISOString()

try {
    await db.exec('set session_replication_role = replica')
    for (const [user, name] of [[owner, 'owner'], [staff, 'staff'], [gone, 'gone']]) await q("insert into auth.users(id,email,raw_user_meta_data) values($1,$2,jsonb_build_object('username',$3::text))", [user, `${name}@example.invalid`, name])
    await q("insert into workspaces(id,name,slug) values($1,'Synthetic','synthetic')", [ws])
    await q("insert into workspace_memberships(workspace_id,user_id,role) values($1,$2,'owner'),($1,$3,'staff')", [ws, owner, staff])
    await q("insert into onboarding_services(id,workspace_id,internal_code) values($1,$2,'ads')", [service, ws])
    await q("insert into onboarding_service_revisions(id,workspace_id,service_id,revision_number,name,default_price_cents) values($1,$2,$3,1,'Ads',0)", [revision, ws, service])
    for (const [client, name, status, phase] of [[active, 'Acme', 'active', 'fulfilment'], [archived, 'Old Co', 'archived', 'fulfilment'], [quiet, 'Quiet Co', 'active', 'onboarding']]) {
        await q('insert into relationships(id,workspace_id,primary_person_name,business_name,status,lifecycle_phase) values($1,$2,$3,$3,$4,$5)', [client, ws, name, status, phase])
    }
    const instance = async (client, assignee, disposition = 'active') => q(`insert into relationship_service_instances(id,workspace_id,relationship_id,service_id,service_revision_id,service_key,source_key,origin,stage,disposition,change_request_id,change_reason,changed_by,assignee_user_id)
        values($1,$2,$3,$4,$5,$6,$7,'already_onboarded','maintenance',$8,$9,'fixture',$10,$11)`, [id(serial++), ws, client, service, revision, `svc-${serial}`, `src-${serial}`, disposition, id(serial++), owner, assignee])
    await instance(active, null)                 // counts: unassigned
    await instance(active, staff)                // assigned
    await instance(archived, null)               // archived client
    await instance(active, null, 'cancelled')    // cancelled
    const message = (client, direction, at) => q(`insert into client_messages(workspace_id,relationship_id,direction,provider,status,created_at,sender_kind)
        values($1,$2,$3,'whatsapp','delivered',$4,$5)`, [ws, client, direction, at, direction === 'inbound' ? 'client' : 'staff'])
    await message(active, 'outbound', days(3)); await message(active, 'inbound', days(2))   // waiting
    await message(quiet, 'inbound', days(3)); await message(quiet, 'outbound', days(1))     // answered
    const session = async (client, updated) => { const s = id(serial++); await q("insert into relationship_onboarding_sessions(id,workspace_id,relationship_id,status,updated_at,created_at,session_token) values($1,$2,$3,'active',$4,$4,$5)", [s, ws, client, updated, `token-${s}`]); return s }
    const stalled = await session(quiet, days(10))
    const moving = await session(active, days(10))
    const work = async ({ title, status = 'todo', due = null, ownerId = null, kind = null, meta = {}, updated = null }) => {
        const w = id(serial++)
        await q(`insert into work_items(id,workspace_id,title,status,due_date,execution_owner_id,native_kind,metadata,updated_at) values($1,$2,$3,$4,$5,$6,$7,$8::jsonb,coalesce($9::timestamptz,now()))`,
            [w, ws, title, status, due, ownerId, kind, JSON.stringify(meta), updated])
        return w
    }
    await work({ title: 'Step done yesterday', kind: 'onboarding_step', meta: { session_id: moving }, updated: days(1) })
    await work({ title: 'Old step', kind: 'onboarding_step', meta: { session_id: stalled }, updated: days(9) })
    const overdue = await work({ title: 'Overdue report', due: days(3).slice(0, 10) })
    await work({ title: 'Finished overdue', status: 'done', due: days(3).slice(0, 10) })
    await work({ title: 'Due later', due: new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10) })
    const disputedOpen = await work({ title: 'Disputed open' })
    const disputedDone = await work({ title: 'Disputed but canceled', status: 'canceled' })
    for (const w of [disputedOpen, disputedDone]) await q("insert into work_queue_disputes(workspace_id,work_item_id,user_id,resolver_id,request_id,reason,blocking,snapshot) values($1,$2,$3,$4,$5,'other',false,'{}')", [ws, w, staff, owner, id(serial++)])
    const orphaned = await work({ title: 'Left behind', ownerId: gone })
    await db.exec('set session_replication_role = origin')
    pass('full schema replays with the new migration and the fixture seeds')

    const [{ r }] = await q('select public.workspace_needs_attention($1,$2) r', [ws, owner])
    const byKind = Object.fromEntries(r.map(k => [k.kind, k]))
    assert.deepEqual(Object.keys(byKind).sort(), ['disputed_task', 'overdue_task', 'removed_member_work', 'stalled_onboarding', 'unassigned_service', 'waiting_on_reply'])
    assert.equal(byKind.unassigned_service.total, 1)
    assert.deepEqual(byKind.waiting_on_reply.items.map(i => i.client), ['Acme'])
    assert.deepEqual(byKind.stalled_onboarding.items.map(i => i.recordId), [stalled])
    assert.deepEqual(byKind.disputed_task.items.map(i => i.recordId), [disputedOpen])
    assert.deepEqual(byKind.overdue_task.items.map(i => i.recordId), [overdue])
    assert.deepEqual(byKind.removed_member_work.items.map(i => i.recordId), [orphaned])
    pass('each kind finds its case and skips archived clients, cancelled services, answered chats, recent progress and finished tasks')

    await assert.rejects(q('select public.workspace_needs_attention($1,$2)', [ws, staff]), /Owner or admin required/)
    const [{ granted }] = await q("select has_function_privilege('authenticated', 'public.workspace_needs_attention(uuid,uuid)', 'execute') as granted")
    assert.equal(granted, false)
    pass('staff are refused and browser sessions cannot call it')

    console.log(`needs attention: ${checks} checks passed`)
} finally {
    await db.close()
}
