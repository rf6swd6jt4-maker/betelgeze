import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { PGlite, repositoryRoot } from './pglite-fixture.mjs'

const db = new PGlite()
const read = (path) => readFile(`${repositoryRoot}${path}`, 'utf8')
const id = (value) => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`
const workspace = id(1), foreignWorkspace = id(2)
const users = { ordinary: id(10), seller: id(11), manager: id(12), optional: id(13), assignee: id(14), owner: id(15), admin: id(16), other: id(17) }
const query = (sql, values = []) => db.query(sql, values)
const contacts = async (user, scope = workspace) => (await query('select * from public.read_search_contact_channels($1, $2)', [scope, user])).rows
const addresses = (rows) => rows.map((row) => row.external_address).sort()
const report = (name) => { passed += 1; console.log(`PASS: ${name}`) }
let passed = 0

try {
    await db.exec(`
        create role anon; create role authenticated; create role service_role;
        create schema auth;
        create function auth.uid() returns uuid language sql as $$ select null::uuid $$;
        create table workspaces(id uuid primary key, status text not null default 'active');
        create table workspace_memberships(workspace_id uuid, user_id uuid, role text, primary key(workspace_id, user_id));
        create table relationships(id uuid primary key, workspace_id uuid not null, client_id uuid, status text not null default 'active', seller_user_id uuid, fulfilment_manager_user_id uuid);
        create table relationship_client_chat_members(workspace_id uuid, relationship_id uuid, user_id uuid, primary key(relationship_id, user_id));
        create table relationship_services(workspace_id uuid, relationship_id uuid, assignee_user_id uuid);
        create table client_communication_channels(id uuid primary key, workspace_id uuid not null, client_id uuid not null, relationship_id uuid, external_address text not null, provider text not null, is_active boolean not null default true);
    `)
    let policy, policySource
    for (const file of (await readdir(`${repositoryRoot}supabase/migrations`)).filter((name) => name.endsWith('.sql')).sort()) {
        const source = await read(`supabase/migrations/${file}`)
        const definitions = [...source.matchAll(/create(?: or replace)? function public\.client_conversation_can_access\([\s\S]*?\$\$;/gu)]
        if (definitions.length) { policy = definitions.at(-1)[0]; policySource = file }
    }
    assert.ok(policy, 'load the last effective conversation policy, never an authorization stub')
    await db.exec(policy)
    // Install the real existing indexes relevant to these reads.
    for (const [path, name] of [
        ['supabase/migrations/20260706120000_relationship_navigation_foundation.sql', 'relationships_client_id_unique'],
        ['supabase/migrations/20260817110000_twilio_omnichannel_messaging.sql', 'client_communication_channels_workspace_client_provider_unique'],
    ]) {
        const source = await read(path)
        const index = source.match(new RegExp(`create unique index if not exists ${name}[\\s\\S]*?;`, 'u'))?.[0]
        assert.ok(index, name)
        await db.exec(index)
    }
    const migration = await read('supabase/migrations/20260929120000_search_contact_authorization.sql')
    await db.exec(migration)
    await query('insert into workspaces(id) values ($1), ($2)', [workspace, foreignWorkspace])
    for (const [name, user] of Object.entries(users)) {
        await query('insert into workspace_memberships values ($1, $2, $3)', [workspace, user, ['owner', 'admin'].includes(name) ? name : 'staff'])
    }
    await query('insert into workspace_memberships values ($1, $2, $3)', [foreignWorkspace, users.other, 'owner'])
    for (const [number, scope, status, seller, manager] of [
        [100, workspace, 'active', users.seller, users.manager],
        [101, workspace, 'active', users.other, null],
        [102, workspace, 'archived', users.seller, users.manager],
        [103, foreignWorkspace, 'active', users.other, null],
    ]) {
        await query('insert into relationships values ($1, $2, $3, $4, $5, $6)', [id(number), scope, id(number + 100), status, seller, manager])
    }
    await query('insert into relationship_client_chat_members values ($1, $2, $3)', [workspace, id(100), users.optional])
    await query('insert into relationship_services values ($1, $2, $3)', [workspace, id(100), users.assignee])
    for (const [number, scope, client, link, provider, active] of [
        [1000, workspace, 200, 100, 'meta_whatsapp', true],
        [1001, workspace, 201, 101, 'meta_whatsapp', true],
        [1002, workspace, 202, 102, 'meta_whatsapp', true],
        [1003, workspace, 203, 100, 'meta_whatsapp', true],
        [1004, workspace, 204, 100, 'meta_whatsapp', true],
        [1005, workspace, 201, 100, 'twilio_sms', true],
        [1006, workspace, 200, 101, 'twilio_sms', true],
        [1007, workspace, 200, 100, 'legacy', false],
        [1008, foreignWorkspace, 203, 103, 'meta_whatsapp', true],
    ]) {
        await query('insert into client_communication_channels values ($1, $2, $3, $4, $5, $6, $7)', [id(number), scope, id(client), id(link), `synthetic-${number}`, provider, active])
    }

    // This is the old privileged query: the denied contact was observable.
    const prior = (await query('select id, client_id, external_address, provider from client_communication_channels where workspace_id=$1 limit 60', [workspace])).rows
    assert.ok(prior.some((row) => row.external_address === 'synthetic-1001'))
    assert.deepEqual(await contacts(users.ordinary), [])
    report('reproduces old workspace contact disclosure; ordinary unassigned staff now receive none')
    for (const name of ['seller', 'manager', 'optional']) {
        const rows = await contacts(users[name])
        assert.deepEqual(addresses(rows), ['synthetic-1000', 'synthetic-1006'])
        assert.ok(rows.every((row) => row.relationship_id === id(100)))
        assert.deepEqual(Object.keys(rows[0]).sort(), ['external_address', 'provider', 'relationship_id'])
    }
    report('seller, manager and explicit optional participants receive only minimal authorized contacts')
    for (const name of ['assignee', 'owner', 'admin']) assert.deepEqual(await contacts(users[name]), [])
    report('service assignment and owner/admin authority alone never grant conversation discovery')
    for (const name of ['owner', 'admin']) {
        await query('insert into relationship_client_chat_members values ($1, $2, $3)', [workspace, id(100), users[name]])
        assert.deepEqual(addresses(await contacts(users[name])), ['synthetic-1000', 'synthetic-1006'])
        await query('delete from relationship_client_chat_members where user_id=$1', [users[name]])
    }
    report('owner/admin participants retain the same legitimate access as other participants')
    await query('delete from relationship_client_chat_members where user_id=$1', [users.optional])
    assert.deepEqual(await contacts(users.optional), [])
    await query('insert into relationship_client_chat_members values ($1, $2, $3)', [workspace, id(100), users.optional])
    await query('delete from workspace_memberships where workspace_id=$1 and user_id=$2', [workspace, users.optional])
    assert.deepEqual(await contacts(users.optional), [])
    report('removed optional participation and removed workspace membership take effect on the next read')
    await query('update relationships set seller_user_id=$1 where id=$2', [users.other, id(100)])
    assert.deepEqual(await contacts(users.seller), [])
    await query('update relationships set seller_user_id=$1 where id=$2', [users.seller, id(100)])
    await query('update relationships set fulfilment_manager_user_id=null where id=$1', [id(100)])
    assert.deepEqual(await contacts(users.manager), [])
    await query('update relationships set fulfilment_manager_user_id=$1 where id=$2', [users.manager, id(100)])
    report('seller and manager replacement revoke the previous participant immediately')
    assert.deepEqual(await contacts(users.seller, foreignWorkspace), [])
    assert.deepEqual(await contacts(null), [])
    assert.deepEqual(await contacts(id(999)), [])
    assert.deepEqual(await contacts(users.seller, id(999)), [])
    assert.deepEqual(addresses(await contacts(users.other, foreignWorkspace)), ['synthetic-1008'])
    report('cross-workspace, unknown actor/workspace and null actor are closed')
    assert.deepEqual(addresses(await contacts(users.seller)), ['synthetic-1000', 'synthetic-1006'])
    report('archived, inactive, orphan and foreign-client channels are excluded; forged relationship links cannot grant access')
    await query("update workspaces set status='suspended' where id=$1", [workspace])
    assert.deepEqual(await contacts(users.seller), [])
    await query("update workspaces set status='active' where id=$1", [workspace])
    report('suspended workspace is closed even when membership remains')
    for (const role of ['anon', 'authenticated']) {
        await db.exec(`set role ${role}`)
        await assert.rejects(contacts(users.seller), /permission denied for function read_search_contact_channels/u)
        await db.exec('reset role')
    }
    await db.exec('set role service_role')
    assert.deepEqual(addresses(await contacts(users.seller)), ['synthetic-1000', 'synthetic-1006'])
    await db.exec('reset role')
    report('only the server service role can supply an actor; anonymous/authenticated RPC calls are denied')

    // Inspect the exact new query body so security-definer function opacity does
    // not hide a workspace-wide scan or policy work in EXPLAIN.
    const body = migration.match(/return query\s+([\s\S]*?);\s*-- The materialized/u)?.[1]
    assert.ok(body, 'extract the deployed statement for plan inspection')
    const planSql = body.replaceAll('p_workspace_id', '$1').replaceAll('p_user_id', '$2')
    const policyBody = policy.slice(policy.indexOf('as $$') + 5, policy.lastIndexOf('$$'))
    const nodes = (plan) => [plan, ...(plan.Plans ?? []).flatMap(nodes)]
    const growth = []
    // Instrument a wrapper around the exact same real policy only for the
    // evaluation-count experiment; restore the original before timing/plans.
    await db.exec(`create function fixture_original_client_access(p_workspace_id uuid,p_relationship_id uuid,p_user_id uuid) returns boolean language sql stable security definer set search_path=public as $$${policyBody}$$; create sequence fixture_access_calls;`)
    for (const total of [1000, 10000]) {
        await db.exec(`
            insert into relationships(id,workspace_id,client_id,seller_user_id)
            select ('10000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'${workspace}',('20000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'${users.seller}'
            from generate_series(1,${total}) n on conflict do nothing;
            insert into client_communication_channels(id,workspace_id,client_id,external_address,provider)
            select ('30000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'${workspace}',('20000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'synthetic-growth-'||n,'meta_whatsapp'
            from generate_series(1,${total}) n on conflict do nothing;
            analyze;
        `)
        const plan = (await query(`explain(analyze,buffers,format json) ${planSql}`, [workspace, users.seller])).rows[0]['QUERY PLAN'][0]
        const all = nodes(plan.Plan)
        const candidatePlan = all.find((node) => node['Subplan Name'] === 'CTE candidates')
        const mappedPlan = all.find((node) => node['Subplan Name'] === 'CTE mapped')
        assert.ok(candidatePlan && mappedPlan)
        assert.equal(candidatePlan['Actual Rows'], 60)
        assert.ok(mappedPlan['Actual Rows'] <= 60)
        const relationshipLookup = all.find((node) => node['Relation Name'] === 'relationships')
        assert.equal(relationshipLookup?.['Index Name'], 'relationships_client_id_unique')
        assert.ok(relationshipLookup['Actual Loops'] <= 60)
        assert.ok(relationshipLookup['Actual Rows'] <= 1)
        const accessPlan = (await query(`explain(analyze,buffers,format json) ${policyBody.replaceAll('p_workspace_id', '$1').replaceAll('p_relationship_id', '$2').replaceAll('p_user_id', '$3')}`, [workspace, id(100), users.seller])).rows[0]['QUERY PLAN'][0]
        const accessNodes = nodes(accessPlan.Plan)
        assert.ok(accessNodes.some((node) => node['Index Name'] === 'relationships_pkey'))
        const beforeSamples = [], afterSamples = []
        // Warm both paths once, then interleave seven observations per path.
        await contacts(users.seller)
        for (let sample = 0; sample < 7; sample += 1) {
            beforeSamples.push((await query('explain(analyze,format json) select id,client_id,external_address,provider from client_communication_channels where workspace_id=$1 limit 60', [workspace])).rows[0]['QUERY PLAN'][0]['Execution Time'])
            afterSamples.push((await query('explain(analyze,format json) select * from read_search_contact_channels($1,$2)', [workspace, users.seller])).rows[0]['QUERY PLAN'][0]['Execution Time'])
        }
        await db.exec(`create or replace function public.client_conversation_can_access(p_workspace_id uuid,p_relationship_id uuid,p_user_id uuid default auth.uid()) returns boolean language plpgsql volatile security definer set search_path=public as $$ begin perform nextval('fixture_access_calls'); return fixture_original_client_access(p_workspace_id,p_relationship_id,p_user_id); end $$; alter sequence fixture_access_calls restart with 1;`)
        assert.ok((await contacts(users.seller)).length <= 60)
        const checks = Number((await query('select last_value from fixture_access_calls')).rows[0].last_value)
        assert.ok(checks > 0 && checks <= 60, `authorization checks ${checks}`)
        await db.exec(policy.replace('create function', 'create or replace function'))
        growth.push({ records: total, candidates: candidatePlan['Actual Rows'], mapped: mappedPlan['Actual Rows'], authorizationChecks: checks, relationshipLookupIndex: relationshipLookup['Index Name'], relationshipLookupLoops: relationshipLookup['Actual Loops'], oldUnsafeCandidateMedianMs: beforeSamples.sort((a, b) => a - b)[3], secureRpcMedianMs: afterSamples.sort((a, b) => a - b)[3], samplesPerPath: 7 })
    }
    await db.exec(`update client_communication_channels set is_active=false where external_address like 'synthetic-growth-%' and split_part(external_address,'-',3)::integer <= 9940; analyze;`)
    const sparsePlan = (await query(`explain(analyze,buffers,format json) ${planSql}`, [workspace, users.seller])).rows[0]['QUERY PLAN'][0]
    const sparseChannelScan = nodes(sparsePlan.Plan).find((node) => node['Relation Name'] === 'client_communication_channels')
    const sparseCandidatePlan = nodes(sparsePlan.Plan).find((node) => node['Subplan Name'] === 'CTE candidates')
    assert.equal(sparseCandidatePlan['Actual Rows'], 60)
    assert.doesNotMatch(sparseChannelScan.Filter ?? '', /is_active/u)
    const sparseActiveSample = { candidates: sparseCandidatePlan['Actual Rows'], returned: sparsePlan.Plan['Actual Rows'], executionMs: sparsePlan['Execution Time'] }
    report('inactive channel history is filtered after the original 60-row sample, never by an expanding pre-sample scan')
    report('1,000 and 10,000-record plans use canonical client index and at most 60 authorization checks; no whole-workspace roster')
    console.log(JSON.stringify({ passed, productionCalls: 0, policySource, growth, sparseActiveSample, limitation: 'Synthetic in-memory PGlite observations; database execution only, not authenticated production search or end-to-end latency. The old baseline is intentionally unsafe and does not perform authorization.' }, null, 2))
} finally {
    await db.close()
}
