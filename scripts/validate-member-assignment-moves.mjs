// Reassign-only and reassign-and-remove commands (supabase/migrations/20261114180000_member_assignment_moves.sql) against
// the REAL combined schema: every committed migration replayed in memory. No credentials, no Supabase connection.
// Fixture rows are placed with triggers off (as in validate-assignment-offboarding-full-schema.mjs); every command runs
// with triggers on, so the sold-team guards, chat sync and work validation all apply.
import assert from 'node:assert/strict'
import { replayFullSchema } from './assignment-full-schema/replay.mjs'

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const ws = id(1), owner = id(2), admin = id(3), source = id(4), recipient = id(5), third = id(6), outsider = id(7)
const service = id(20), revision = id(21), otherService = id(22), otherRevision = id(23)
const clientA = id(30), clientB = id(31)
const instanceA = id(40), instanceB = id(41)
const header = id(50), task1 = id(51), task2 = id(52), standalone = id(53), loose = id(54)

const { db } = await replayFullSchema()
const q = async (sql, args = []) => (await db.query(sql, args)).rows
const one = async (sql, args = []) => (await q(sql, args))[0]
let checks = 0
const pass = label => { checks++; console.log(`PASS ${checks}: ${label}`) }
const refuses = (sql, args, re) => assert.rejects(q(sql, args), re)
let serial = 1000
const request = () => id(serial++)

const preview = async (actor = owner, target = source) =>
    (await one('select public.preview_workspace_member_footprint($1,$2,$3) p', [ws, actor, target])).p
const item = (p, key) => p.items.find(i => i.key === key)
const plan = (p, keys, to) => keys.map(key => ({ key, fingerprint: item(p, key).fingerprint, recipientId: to }))
const reassign = (input, req = request(), actor = owner, from = source) =>
    one('select public.reassign_workspace_member_items($1,$2,$3,$4,$5) r', [ws, actor, req, from, input]).then(r => r.r)
const offboard = (input, req = request(), actor = owner, target = source) =>
    one('select public.offboard_workspace_member($1,$2,$3,$4,$5) r', [ws, actor, req, target, input]).then(r => r.r)
const owners = async ids => Object.fromEntries((await q('select id, execution_owner_id from work_items where id = any($1)', [ids])).map(r => [r.id, r.execution_owner_id]))
const collaborators = async work => (await q('select user_id from work_item_assignees where work_item_id=$1 order by user_id', [work])).map(r => r.user_id)
const isMember = async user => !!(await one('select 1 x from workspace_memberships where workspace_id=$1 and user_id=$2', [ws, user]))

try {
    await db.exec('set session_replication_role = replica')
    for (const [user, name] of [[owner, 'owner'], [admin, 'admin'], [source, 'source'], [recipient, 'recipient'], [third, 'third'], [outsider, 'outsider']]) {
        await q("insert into auth.users(id,email,raw_user_meta_data) values($1,$2,jsonb_build_object('username',$3::text))", [user, `${name}@example.invalid`, `${name}-user`])
    }
    await q("insert into workspaces(id,name,slug) values($1,'Synthetic','synthetic')", [ws])
    await q("insert into workspace_memberships(workspace_id,user_id,role) values($1,$2,'owner'),($1,$3,'admin'),($1,$4,'staff'),($1,$5,'staff'),($1,$6,'staff')", [ws, owner, admin, source, recipient, third])
    for (const [serviceId, revisionId, code] of [[service, revision, 'ads'], [otherService, otherRevision, 'seo']]) {
        await q('insert into onboarding_services(id,workspace_id,internal_code) values($1,$2,$3)', [serviceId, ws, code])
        await q('insert into onboarding_service_revisions(id,workspace_id,service_id,revision_number,name,default_price_cents) values($1,$2,$3,1,$4,0)', [revisionId, ws, serviceId, code.toUpperCase()])
    }
    await q('insert into workspace_member_service_access(workspace_id,user_id,service_id) values($1,$2,$5),($1,$3,$5),($1,$4,$5),($1,$2,$6),($1,$3,$6)', [ws, source, recipient, third, service, otherService])
    await q('insert into workspace_operational_roles(workspace_id,user_id,can_manage) values($1,$2,true),($1,$3,true),($1,$4,true) on conflict (workspace_id,user_id) do update set can_manage=true', [ws, source, recipient, third])
    for (const [client, name, manager] of [[clientA, 'Acme Plumbing', source], [clientB, 'Bright Dental', third]]) {
        await q(`insert into relationships(id,workspace_id,primary_person_name,business_name,status,lifecycle_phase,fulfilment_manager_user_id,seller_user_id,team_locked_at,pos_started_at)
                 values($1,$2,$3,$3,'active','fulfilment',$4,$5,now(),now())`, [client, ws, name, manager, source])
    }
    await q("insert into relationship_services(workspace_id,relationship_id,service_key,service_id,assignee_user_id) values($1,$2,'seo',$3,$4)", [ws, clientA, otherService, source])
    for (const [inst, client, assignee] of [[instanceA, clientA, source], [instanceB, clientB, third]]) {
        await q(`insert into relationship_service_instances(id,workspace_id,relationship_id,service_id,service_revision_id,service_key,source_key,origin,stage,disposition,change_request_id,change_reason,changed_by,assignee_user_id)
                 values($1,$2,$3,$4,$5,$6,$7,'already_onboarded','maintenance','active',$8,'fixture',$9,$10)`, [inst, ws, client, service, revision, `svc-${inst}`, `src-${inst}`, request(), owner, assignee])
        await q('insert into service_queue_rosters(workspace_id,instance_id) values($1,$2)', [ws, inst])
    }
    await q('insert into service_queue_members(workspace_id,instance_id,user_id,added_by) values($1,$2,$3,$4)', [ws, instanceB, source, owner])
    const work = async (workId, { title, role = 'task', ownerId = null, collab = [], client = null, inst = null, serviceId = null }) => {
        await q("insert into work_items(id,workspace_id,title,status,workflow_role,execution_owner_id,service_id) values($1,$2,$3,'todo',$4,$5,$6)", [workId, ws, title, role, ownerId, serviceId])
        for (const user of collab) await q('insert into work_item_assignees(work_item_id,user_id,workspace_id) values($1,$2,$3)', [workId, user, ws])
        if (client) await q('insert into work_item_relationships(work_item_id,relationship_id,workspace_id) values($1,$2,$3)', [workId, client, ws])
        if (inst) await q('insert into service_instance_work_items(workspace_id,instance_id,work_item_id) values($1,$2,$3)', [ws, inst, workId])
    }
    await work(header, { title: 'Ads setup', role: 'service_group', collab: [source], client: clientA, inst: instanceA, serviceId: service })
    await work(task1, { title: 'Build campaign', ownerId: source, collab: [source], client: clientA, inst: instanceA, serviceId: service })
    await work(task2, { title: 'Write copy', collab: [source, third], client: clientA, inst: instanceA, serviceId: service })
    await work(standalone, { title: 'Quarterly review', ownerId: source, collab: [source], client: clientA })
    await work(loose, { title: 'Tidy shared drive', collab: [source] })
    await db.exec('set session_replication_role = origin')
    pass('full schema replays with the new migration and the fixture seeds')

    // Preview: one entry per movable responsibility; work under the person's own service follows it.
    let p = await preview()
    const keys = p.items.map(i => i.key).sort()
    assert.deepEqual(keys, [
        `client_manager:${clientA}`,
        `legacy_service_assignee:${clientA}:seo`,
        `queue_member:${instanceB}`,
        `service_assignee:${instanceA}`,
        `work_collaborator:${loose}`,
        `work_owner:${standalone}`,
    ].sort())
    assert.equal(p.history.sellerClients, 2)
    assert.ok(p.eligibility.managers.includes(recipient) && !p.eligibility.managers.includes(source))
    assert.ok(p.eligibility[`service:${service}`].includes(recipient))
    assert.equal(item(p, `service_assignee:${instanceA}`).eligibleGroup, `service:${service}`)
    pass('preview lists each responsibility once, keeps sellers as history and gives eligible people per group')

    // The sold-client locks still hold everywhere outside the commands.
    await refuses('update relationships set fulfilment_manager_user_id=$3 where workspace_id=$1 and id=$2', [ws, clientA, recipient], /sold client team cannot be changed/)
    await refuses("update relationship_services set assignee_user_id=$3 where workspace_id=$1 and relationship_id=$2 and service_key='seo'", [ws, clientA, recipient], /sold client service assignment cannot be changed/)
    pass('outside the commands, a sold client manager and service assignment stay locked')

    // Refusals leave everything unchanged.
    const reason = 'Covering while away'
    await assert.rejects(reassign({ reason, plan: plan(p, [`work_owner:${standalone}`], source) }), /someone other than/)
    await assert.rejects(reassign({ reason, plan: plan(p, [`work_owner:${standalone}`], outsider) }), /current workspace members/)
    await assert.rejects(reassign({ reason, plan: plan(p, [`service_assignee:${instanceA}`], admin) }), /not eligible for that service/)
    await assert.rejects(reassign({ reason, plan: plan(p, [`work_owner:${standalone}`], null) }), /Choose who takes/)
    await assert.rejects(reassign({ reason, plan: [] }), /at least one/)
    await assert.rejects(reassign({ plan: plan(p, [`work_owner:${standalone}`], admin) }), /reason is required/)
    await assert.rejects(reassign({ reason, plan: plan(p, [`work_owner:${standalone}`], admin) }, request(), admin, owner), /Admins cannot move an owner/)
    await assert.rejects(reassign({ reason, plan: plan(p, [`work_owner:${standalone}`], admin) }, request(), third), /Owner or admin required/)
    assert.equal((await owners([standalone]))[standalone], source)
    pass('self, non-member, ineligible, unassigned, empty, unexplained, admin-on-owner and staff requests are refused')

    // One failing item rolls back the whole request.
    await assert.rejects(reassign({ reason, plan: [...plan(p, [`work_owner:${standalone}`], admin), ...plan(p, [`service_assignee:${instanceA}`], admin)] }), /not eligible/)
    assert.equal((await owners([standalone]))[standalone], source)
    assert.equal((await one('select assignee_user_id a from relationship_service_instances where id=$1', [instanceA])).a, source)
    pass('a request with one bad item moves nothing')

    // Partial move: only the planned item changes; membership and everything else stay.
    const firstRequest = request()
    const firstInput = { reason, plan: plan(p, [`work_owner:${standalone}`], admin) }
    const first = await reassign(firstInput, firstRequest)
    assert.equal(first.moved.length, 1)
    assert.equal((await owners([standalone]))[standalone], admin)
    assert.deepEqual(await collaborators(standalone), [admin].sort())
    assert.equal(await isMember(source), true)
    assert.equal((await one('select fulfilment_manager_user_id m from relationships where id=$1', [clientA])).m, source)
    pass('a partial move changes only the planned task and leaves the person a member')

    assert.deepEqual(await reassign(firstInput, firstRequest), first)
    await assert.rejects(reassign({ ...firstInput, reason: 'Different' }, firstRequest), /reused with different input/)
    assert.equal((await one('select count(*)::int n from member_move_receipts where request_id=$1', [firstRequest])).n, 1)
    pass('repeating a request returns the same result; reusing its id with other input is refused')

    // Conflicts: a planned item that changed fails; an unplanned change does not block.
    p = await preview()
    const stale = plan(p, [`work_collaborator:${loose}`], admin)
    await q("update work_items set title='Tidy the shared drive' where id=$1", [loose])
    await assert.rejects(reassign({ reason, plan: stale }), /Assignments changed/)
    const managerPlan = plan(p, [`client_manager:${clientA}`], recipient)
    await q("update work_items set title='Tidy the drive' where id=$1", [loose])
    await reassign({ reason, plan: managerPlan })
    assert.equal((await one('select fulfilment_manager_user_id m from relationships where id=$1', [clientA])).m, recipient)
    pass('a changed planned item fails, an unrelated change does not, and a sold client manager moves through the command')

    // Moving the service takes its tasks and group header, and only the source's part of each.
    p = await preview()
    await reassign({ reason, plan: plan(p, [`service_assignee:${instanceA}`, `legacy_service_assignee:${clientA}:seo`], recipient) })
    assert.equal((await one('select assignee_user_id a from relationship_service_instances where id=$1', [instanceA])).a, recipient)
    assert.equal((await one("select assignee_user_id a from relationship_services where relationship_id=$1 and service_key='seo'", [clientA])).a, recipient)
    assert.equal((await owners([task1]))[task1], recipient)
    assert.deepEqual(await collaborators(header), [recipient])
    assert.deepEqual(await collaborators(task2), [recipient, third].sort())
    assert.equal((await one('select count(*)::int n from member_move_permits')).n, 0)
    pass('a moved service takes its tasks and group header, keeps other collaborators, and leaves no permit behind')

    // Removal must cover every client, service and queue; open tasks may be left only by explicit choice.
    p = await preview()
    assert.deepEqual(p.items.map(i => i.key).sort(), [`queue_member:${instanceB}`, `work_collaborator:${loose}`].sort())
    await assert.rejects(offboard({ reason, footprintFingerprint: p.fingerprint, leaveOpenWork: true, plan: [] }), /every assignment/)
    await assert.rejects(offboard({ reason, footprintFingerprint: 'stale', leaveOpenWork: true, plan: plan(p, [`queue_member:${instanceB}`], recipient) }), /Assignments changed/)
    await assert.rejects(offboard({ reason, footprintFingerprint: p.fingerprint, leaveOpenWork: true, plan: plan(p, [`queue_member:${instanceB}`], recipient) }, request(), admin, admin), /Owners cannot|Admins can only remove staff|cannot remove yourself/)
    await assert.rejects(offboard({ reason, footprintFingerprint: p.fingerprint, plan: [] }, request(), owner, owner), /Owners cannot be removed/)
    assert.equal(await isMember(source), true)
    pass('removal refuses an uncovered queue, a stale footprint, owners and self-removal, and keeps the member')

    const done = await offboard({ reason, footprintFingerprint: p.fingerprint, leaveOpenWork: true, plan: plan(p, [`queue_member:${instanceB}`], recipient) })
    assert.equal(done.removed, true)
    assert.equal(await isMember(source), false)
    assert.deepEqual((await q('select user_id from service_queue_members where instance_id=$1', [instanceB])).map(r => r.user_id), [recipient])
    assert.deepEqual(await collaborators(loose), [])
    assert.equal((await q('select * from public.member_assignment_footprint($1,$2,null)', [ws, source])).length, 0)
    pass('reassign and remove moves the queue, leaves the open task unassigned by choice, removes the member and leaves nothing behind')

    console.log(`member assignment moves: ${checks} checks passed`)
} finally {
    await db.close()
}
