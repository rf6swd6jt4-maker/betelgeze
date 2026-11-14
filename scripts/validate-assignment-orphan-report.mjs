// Checks scripts/assignment-orphan-report.sql against the REAL combined schema (every committed migration
// replayed in memory, see assignment-full-schema/replay.mjs). No credentials, no Supabase connection.
// Synthetic users and clients only. Fixture rows are written with triggers off so each row can be placed
// in exactly the state under test; the report itself runs unchanged.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { replayFullSchema } from './assignment-full-schema/replay.mjs'

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const ws = id(1), otherWs = id(2), owner = id(3), current = id(4), former = id(5)
const service = id(20), revision = id(21)
const activeClient = id(30), archivedClient = id(31), lostClient = id(32), otherWsClient = id(33)

const report = await readFile(new URL('./assignment-orphan-report.sql', import.meta.url), 'utf8')
const { db } = await replayFullSchema()
const q = async (sql, args = []) => (await db.query(sql, args)).rows
let checks = 0
const pass = label => { checks++; console.log(`PASS ${checks}: ${label}`) }

let serial = 100
async function instance(relationship, { workspace = ws, stage = 'maintenance', disposition = 'active', assignee = null, manager = null } = {}) {
    const instanceId = id(serial++)
    await q(`insert into relationship_service_instances(id,workspace_id,relationship_id,service_id,service_revision_id,service_key,source_key,origin,stage,disposition,change_request_id,change_reason,changed_by,assignee_user_id,manager_user_id)
             values($1,$2,$3,$4,$5,$6,$7,'already_onboarded',$8,$9,$10,'fixture',$11,$12,$13)`,
        [instanceId, workspace, relationship, service, revision, `svc-${instanceId}`, `src-${instanceId}`, stage, disposition, id(serial++), owner, assignee, manager])
    return instanceId
}
async function work({ workspace = ws, status = 'todo', ownerId = null, collaborators = [], archived = false, client = null } = {}) {
    const workId = id(serial++)
    await q(`insert into work_items(id,workspace_id,title,status,execution_owner_id,metadata) values($1,$2,'Synthetic task',$3,$4,$5::jsonb)`,
        [workId, workspace, status, ownerId, JSON.stringify(archived ? { archived_at: '2026-11-01T00:00:00Z' } : {})])
    for (const user of collaborators) await q('insert into work_item_assignees(work_item_id,user_id,workspace_id) values($1,$2,$3)', [workId, user, workspace])
    if (client) await q('insert into work_item_relationships(work_item_id,relationship_id,workspace_id) values($1,$2,$3)', [workId, client, workspace])
    return workId
}

try {
    await db.exec('set session_replication_role = replica')
    for (const [user, name] of [[owner, 'owner'], [current, 'current'], [former, 'former']]) await q("insert into auth.users(id,email,raw_user_meta_data) values($1,$2,jsonb_build_object('username',$3::text))", [user, `${name}@example.invalid`, `${name}-user`])
    await q("insert into workspaces(id,name,slug) values($1,'Synthetic','synthetic'),($2,'Other','other')", [ws, otherWs])
    // `former` is no longer a member of ws, but still is of otherWs.
    await q("insert into workspace_memberships(workspace_id,user_id,role) values($1,$2,'owner'),($1,$3,'staff'),($4,$2,'owner'),($4,$5,'staff')", [ws, owner, current, otherWs, former])
    const client = (clientId, workspace, extra) => q(`insert into relationships(id,workspace_id,primary_person_name,business_name,status,lifecycle_phase,fulfilment_manager_user_id,seller_user_id)
        values($1,$2,'Synthetic','Synthetic',$3,$4,$5,$6)`, [clientId, workspace, extra.status ?? 'active', extra.phase ?? 'fulfilment', extra.manager ?? null, extra.seller ?? null])
    await client(activeClient, ws, { manager: former, seller: former })
    await client(archivedClient, ws, { status: 'archived', manager: former, seller: former })
    await client(lostClient, ws, { phase: 'completed_lost', manager: former })
    await client(otherWsClient, otherWs, { manager: former })

    await q("insert into relationship_services(workspace_id,relationship_id,service_key,assignee_user_id) values($1,$2,'seo',$3)", [ws, activeClient, former])
    await q("insert into relationship_services(workspace_id,relationship_id,service_key,assignee_user_id) values($1,$2,'ads',$3)", [ws, archivedClient, former])

    const activeInstance = await instance(activeClient, { assignee: former, manager: former })
    await instance(activeClient, { assignee: current })
    await instance(activeClient, { disposition: 'cancelled', assignee: former })
    await instance(archivedClient, { assignee: former })

    const openOwned = await work({ ownerId: former, collaborators: [former, current], client: activeClient })
    const archivedOwned = await work({ ownerId: former, client: archivedClient })
    await work({ status: 'done', ownerId: former, collaborators: [former] })
    await work({ status: 'canceled', ownerId: former })
    await work({ archived: true, ownerId: former })
    await work({ ownerId: current, collaborators: [current] })
    await work({ workspace: otherWs, ownerId: former, collaborators: [former] })
    await db.exec('set session_replication_role = origin')

    const before = await q('select (select count(*) from relationships)::int r, (select count(*) from work_items)::int w, (select count(*) from relationship_service_instances)::int i')
    const results = await db.exec(report)
    const rows = results.find(result => result.fields?.some(field => field.name === 'kind'))?.rows
    assert.ok(rows, 'report returned no result set')
    pass('report runs against the full combined schema')

    const got = rows.map(row => `${row.kind}:${row.record_id}${row.service_key ? `:${row.service_key}` : ''}`).sort()
    const expected = [
        `client_manager:${activeClient}`,
        `legacy_service_assignee:${activeClient}:seo`,
        `seller_history_kept:${activeClient}`,
        `service_instance_assignee:${activeInstance}`,
        `service_instance_manager:${activeInstance}`,
        `work_collaborator:${openOwned}`,
        `work_owner:${openOwned}`,
        `work_owner:${archivedOwned}`,
    ].sort()
    assert.deepEqual(got, expected)
    pass('finds every kind of assignment left on a former member')
    pass('ignores managers and services on archived or lost clients, cancelled instances, and done, canceled or archived work')
    pass('ignores current members, and people who are still members of the other workspace')

    assert.ok(rows.every(row => row.workspace_id === ws && row.former_member_user_id === former))
    assert.ok(rows.every(row => Number(row.kind_total_in_workspace) === (row.kind === 'work_owner' ? 2 : 1)))
    assert.deepEqual(Object.keys(rows[0]).sort(), ['client_state', 'former_member_user_id', 'kind', 'kind_total_in_workspace', 'record_id', 'record_table', 'service_key', 'workspace_id'])
    pass('returns ids and counts only, no names or content')

    const state = Object.fromEntries(rows.filter(row => row.record_table === 'work_items').map(row => [row.record_id, row.client_state]))
    assert.deepEqual(state, { [openOwned]: 'active', [archivedOwned]: 'archived_or_lost' })
    assert.ok(rows.filter(row => !row.record_table.startsWith('work_')).every(row => row.client_state === 'active'))
    pass('marks open work on archived or lost clients apart from live work')

    const after = await q('select (select count(*) from relationships)::int r, (select count(*) from work_items)::int w, (select count(*) from relationship_service_instances)::int i')
    assert.deepEqual(after, before)
    assert.match(report, /^begin transaction read only;$/m)
    assert.match(report, /^rollback;$/m)
    assert.doesNotMatch(report.replace(/--.*$/gm, ''), /\b(insert|update|delete|alter|drop|create|truncate|grant|revoke)\b/i)
    pass('is read-only and leaves the database unchanged')

    console.log(`assignment orphan report: ${checks} checks passed`)
} finally {
    await db.close()
}
