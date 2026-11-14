// Behavior of the workspace offboarding guards against the REAL combined schema:
// every committed migration replayed in memory (see assignment-full-schema/replay.mjs).
// No credentials, no Supabase connection. Synthetic users and clients only.
import assert from 'node:assert/strict'
import { replayFullSchema } from './assignment-full-schema/replay.mjs'

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const ws = id(1), owner = id(2), admin = id(3), mayank = id(4), other = id(5)
const service = id(20), serviceB = id(21), revision = { [id(20)]: id(22), [id(21)]: id(23) }, clientA = id(30), clientB = id(31), clientC = id(32)
const CLIENT_TEAM = /Client-team handover must be completed/
const SHARED_QUEUE = /Remove this person from shared service assignments/

const { db, applied } = await replayFullSchema()
const q = async (sql, args = []) => (await db.query(sql, args)).rows
let checks = 0
const pass = label => { checks++; console.log(`PASS ${checks}: ${label}`) }
const refuses = (sql, args, re) => assert.rejects(q(sql, args), re)
const removeMember = userId => q('delete from workspace_memberships where workspace_id=$1 and user_id=$2', [ws, userId])
const isMember = async userId => (await q('select 1 from workspace_memberships where workspace_id=$1 and user_id=$2', [ws, userId])).length === 1
const restoreMember = userId => q("insert into workspace_memberships(workspace_id,user_id,role) values($1,$2,'staff') on conflict do nothing", [ws, userId])


// The delivery-team lock normally happens through the sale/POS flow ("Begin POS before selling this
// client"). These checks are about the membership guards, so the relationship row is positioned
// directly with triggers off for that single statement and restored immediately.
async function setRelationship(client, set, args = []) {
    await db.exec("set session_replication_role = replica")
    try { await q(`update relationships set ${set} where workspace_id=$1 and id=$2`, [ws, client, ...args]) }
    finally { await db.exec("set session_replication_role = origin") }
}

// Instance edits normally go through versioned commands (expected version + new request id). The
// membership guards only read stage/disposition, so the fixture sets them directly.
async function setInstance(instanceId, set) {
    await db.exec("set session_replication_role = replica")
    try { await q(`update relationship_service_instances set ${set} where workspace_id=$1 and id=$2`, [ws, instanceId]) }
    finally { await db.exec("set session_replication_role = origin") }
}

let serial = 100
async function instance({ relationship, serviceId = service, stage = 'maintenance', disposition = 'active', members = [], assignee = null }) {
    const instanceId = id(serial++)
    await q(`insert into relationship_service_instances(id,workspace_id,relationship_id,service_id,service_revision_id,service_key,source_key,origin,stage,disposition,change_request_id,change_reason,changed_by,assignee_user_id)
             values($1,$2,$3,$4,$5,$6,$7,'already_onboarded',$8,$9,$10,'fixture',$11,$12)`,
        [instanceId, ws, relationship, serviceId, revision[serviceId], `svc-${instanceId}`, `src-${instanceId}`, stage, disposition, id(serial++), owner, assignee])
    await q('insert into service_queue_rosters(workspace_id,instance_id) values($1,$2)', [ws, instanceId])
    for (const member of members) await q('insert into service_queue_members(workspace_id,instance_id,user_id,added_by) values($1,$2,$3,$4)', [ws, instanceId, member, owner])
    return instanceId
}

try {
    for (const [user, name] of [[owner, 'owner'], [admin, 'admin'], [mayank, 'mayank'], [other, 'other']]) await q("insert into auth.users(id,email,raw_user_meta_data) values($1,$2,jsonb_build_object('username',$3::text))", [user, `${name}@example.invalid`, `${name}-user`])
    await q("insert into workspaces(id,name,slug) values($1,'Synthetic','synthetic')", [ws])
    await q("insert into workspace_memberships(workspace_id,user_id,role) values($1,$2,'owner'),($1,$3,'admin'),($1,$4,'staff'),($1,$5,'staff')", [ws, owner, admin, mayank, other])
    for (const [serviceId, code] of [[service, 'seo'], [serviceB, 'ads']]) {
        await q("insert into onboarding_services(id,workspace_id,internal_code) values($1,$2,$3)", [serviceId, ws, code])
        await q("insert into onboarding_service_revisions(id,workspace_id,service_id,revision_number,name,default_price_cents) values($1,$2,$3,1,$4,0)", [revision[serviceId], ws, serviceId, code.toUpperCase()])
    }
    for (const [client, name] of [[clientA, 'Acme Plumbing'], [clientB, 'Bright Dental'], [clientC, 'Cedar Cafe']]) {
        await q("insert into relationships(id,workspace_id,primary_person_name,business_name) values($1,$2,$3,$3)", [client, ws, name])
    }
    pass(`all ${applied} migrations replay and synthetic workspace seeds`)

    // 1. Nothing assigned: removal is allowed (and the row really goes).
    await removeMember(other)
    assert.equal(await isMember(other), false)
    await restoreMember(other)
    pass('a member with no assignments can be removed')

    // 2. Fulfilment manager of a locked, active client blocks removal.
    await setRelationship(clientA, "fulfilment_manager_user_id=$3, team_locked_at=now(), lifecycle_phase='fulfilment'", [mayank])
    await refuses('delete from workspace_memberships where workspace_id=$1 and user_id=$2', [ws, mayank], CLIENT_TEAM)
    assert.equal(await isMember(mayank), true)
    pass('fulfilment manager of an active locked client blocks removal and nothing is deleted')

    // 3. Only locked, non-archived, non-lost clients count.
    await setRelationship(clientA, "status='archived'")
    await removeMember(mayank)
    assert.equal(await isMember(mayank), false)
    const [{ fulfilment_manager_user_id: staleManager }] = await q('select fulfilment_manager_user_id from relationships where workspace_id=$1 and id=$2', [ws, clientA])
    assert.equal(staleManager, mayank, 'the archived client keeps the former member as fulfilment manager')
    await restoreMember(mayank)
    await setRelationship(clientA, "status='active', lifecycle_phase='completed_lost'")
    await removeMember(mayank)
    await restoreMember(mayank)
    await setRelationship(clientA, "lifecycle_phase='fulfilment', team_locked_at=null")
    await removeMember(mayank)
    await restoreMember(mayank)
    pass('archived, lost and not-yet-locked clients do not block removal')

    // 4. Handing the client to someone else clears the block.
    await setRelationship(clientA, "team_locked_at=now(), fulfilment_manager_user_id=$3", [mayank])
    await refuses('delete from workspace_memberships where workspace_id=$1 and user_id=$2', [ws, mayank], CLIENT_TEAM)
    await setRelationship(clientA, "fulfilment_manager_user_id=$3", [other])
    await removeMember(mayank)
    assert.equal(await isMember(mayank), false)
    await restoreMember(mayank)
    pass('reassigning the fulfilment manager clears the block')

    // 5. Shared service queue membership blocks removal and eligibility removal.
    await q("insert into workspace_member_service_access(workspace_id,user_id,service_id) values($1,$2,$3),($1,$2,$4)", [ws, mayank, service, serviceB])
    const active = await instance({ relationship: clientB, members: [mayank] })
    await refuses('delete from workspace_memberships where workspace_id=$1 and user_id=$2', [ws, mayank], SHARED_QUEUE)
    await refuses('delete from workspace_member_service_access where workspace_id=$1 and user_id=$2 and service_id=$3', [ws, mayank, service], SHARED_QUEUE)
    pass('active shared-queue work blocks both removal and service eligibility removal')

    // 6. Eligibility for a different service is not blocked by this service's queue.
    await q('delete from workspace_member_service_access where workspace_id=$1 and user_id=$2 and service_id=$3', [ws, mayank, serviceB])
    pass('removing eligibility for an unrelated service is allowed')

    // 7. Stage, disposition and client status decide whether a queue entry still counts.
    for (const [label, change] of [
        ['cancelled', "disposition='cancelled'"],
        ['completed', "stage='completed'"],
        ['declined', "stage='declined'"],
    ]) {
        await setInstance(active, change)
        await removeMember(mayank)
        await restoreMember(mayank)
        await setInstance(active, "stage='maintenance', disposition='active'")
        pass(`a ${label} service instance no longer blocks removal`)
    }
    await setRelationship(clientB, "status='archived'")
    await removeMember(mayank)
    await restoreMember(mayank)
    await setRelationship(clientB, "status='active'")
    pass('an archived client no longer blocks removal')

    // 8. Removing the person from the roster first clears the block.
    await q('delete from service_queue_members where workspace_id=$1 and instance_id=$2 and user_id=$3', [ws, active, mayank])
    await q('delete from workspace_member_service_access where workspace_id=$1 and user_id=$2 and service_id=$3', [ws, mayank, service])
    await removeMember(mayank)
    assert.equal(await isMember(mayank), false)
    await restoreMember(mayank)
    pass('leaving the shared roster first lets removal and eligibility removal succeed')

    // 9. The older per-service assignee (relationship_services) also blocks removal of a person on a locked client.
    await setRelationship(clientC, "team_locked_at=now(), lifecycle_phase='fulfilment'")
    await db.exec("set session_replication_role = replica")
    await q("insert into relationship_services(workspace_id,relationship_id,service_key,assignee_user_id) values($1,$2,'seo',$3)", [ws, clientC, mayank])
    await db.exec("set session_replication_role = origin")
    await refuses('delete from workspace_memberships where workspace_id=$1 and user_id=$2', [ws, mayank], CLIENT_TEAM)
    // A sold assignment cannot be edited directly ("The sold client service assignment cannot be changed");
    // the supported route is the transfer command, so the fixture clears it with triggers off.
    await refuses("update relationship_services set assignee_user_id=$3 where workspace_id=$1 and relationship_id=$2", [ws, clientC, other], /sold client service assignment cannot be changed/)
    await db.exec("set session_replication_role = replica")
    await q("update relationship_services set assignee_user_id=$3 where workspace_id=$1 and relationship_id=$2", [ws, clientC, other])
    await db.exec("set session_replication_role = origin")
    await q('delete from service_queue_members where workspace_id=$1 and user_id=$2', [ws, mayank])
    await setRelationship(clientA, "fulfilment_manager_user_id=$3", [other])
    await removeMember(mayank)
    await restoreMember(mayank)
    pass('a legacy per-service assignee on a locked client blocks removal until reassigned')

    // 10. Documented gap: the seller is NOT guarded, so removal succeeds and the client keeps pointing at an ex-member.
    await setRelationship(clientC, "seller_user_id=$3", [mayank])
    await removeMember(mayank)
    const [{ seller_user_id: dangling }] = await q('select seller_user_id from relationships where workspace_id=$1 and id=$2', [ws, clientC])
    assert.equal(dangling, mayank)
    assert.equal(await isMember(mayank), false)
    await restoreMember(mayank)
    console.log('INFO seller_user_id is not an offboarding guard: removal succeeds and the client keeps the former member as seller')
    pass('removing a locked client\'s seller is allowed and leaves seller_user_id pointing at the former member (documented behavior)')

    // 11. Documented gap: the primary service assignee on an active instance is NOT guarded.
    await q('insert into workspace_member_service_access(workspace_id,user_id,service_id) values($1,$2,$3) on conflict do nothing', [ws, mayank, serviceB])
    const primary = await instance({ relationship: clientB, serviceId: serviceB, assignee: mayank })
    await removeMember(mayank)
    assert.equal(await isMember(mayank), false)
    const [{ assignee_user_id: orphanedAssignee }] = await q('select assignee_user_id from relationship_service_instances where workspace_id=$1 and id=$2', [ws, primary])
    assert.equal(orphanedAssignee, mayank)
    await restoreMember(mayank)
    console.log('INFO the primary assignee of an active service instance is not an offboarding guard: removal succeeds and the instance keeps the former member')
    pass('removing the primary assignee of an active service instance is allowed and leaves the instance assigned to the former member (documented behavior)')

    // 12. Documented gap: work-item owners and collaborators are NOT guarded either.
    const workItem = id(serial++)
    await q('insert into work_items(id,workspace_id,title,execution_owner_id) values($1,$2,$3,$4)', [workItem, ws, 'Synthetic task', mayank])
    await removeMember(mayank)
    const [{ execution_owner_id: orphanedOwner }] = await q('select execution_owner_id from work_items where id=$1', [workItem])
    const [{ n: orphanedCollaborators }] = await q('select count(*)::int n from work_item_assignees where work_item_id=$1 and user_id=$2', [workItem, mayank])
    assert.equal(orphanedOwner, mayank)
    assert.equal(orphanedCollaborators, 1)
    await restoreMember(mayank)
    console.log('INFO work items keep the former member as execution owner and collaborator after removal')
    pass('removing a work-item owner is allowed and leaves the task owned by the former member (documented behavior)')

    // 13. Both guards can apply at once: record which message wins, because the UI maps both.
    await setRelationship(clientA, "fulfilment_manager_user_id=$3, team_locked_at=now()", [mayank])
    await q('insert into service_queue_members(workspace_id,instance_id,user_id,added_by) values($1,$2,$3,$4)', [ws, active, mayank, owner])
    let message = ''
    try { await removeMember(mayank) } catch (error) { message = error.message }
    assert.match(message, /Client-team handover must be completed|Remove this person from shared service assignments/)
    console.log(`INFO when both guards apply the database reports: ${message.slice(0, 80)}...`)
    pass('a person blocked by both guards is still refused with one recognised message')
    console.log(`\nAll ${checks} assignment offboarding checks passed on the full ${applied}-migration schema.`)
} catch (error) {
    console.error(`FAIL after ${checks} checks:`, error.message)
    process.exitCode = 1
} finally {
    await db.close()
}
