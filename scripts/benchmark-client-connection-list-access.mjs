// Read-only isolated SQL comparison of the client list authorization shape.
// Synthetic indexed data; no credentials, production, or provider requests.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { PGlite, repositoryRoot } from './pglite-fixture.mjs'

const db = new PGlite()
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const workspace = uuid(1)
const verifyOnly = process.env.BE_CONNECTION_LIST_VERIFY_ONLY === '1'
const migration = name => readFile(`${repositoryRoot}/supabase/migrations/${name}`, 'utf8')
const one = async (sql, args = []) => (await db.query(sql, args)).rows[0]
try {
    await db.exec(`
        create schema auth; create schema client_portal_secure;
        create function auth.uid() returns uuid language sql as $$select null::uuid$$;
        create function auth.role() returns text language sql as $$select 'service_role'::text$$;
        create table workspaces(id uuid primary key,status text);
        create table workspace_memberships(workspace_id uuid,user_id uuid,role text,primary key(workspace_id,user_id));
        create table relationships(workspace_id uuid,id uuid,status text,lifecycle_phase text,primary_person_name text,business_name text,primary key(workspace_id,id));
        create table onboarding_service_revisions(workspace_id uuid,id uuid,service_id uuid,definition jsonb,primary key(workspace_id,id));
        create table relationship_services(workspace_id uuid,relationship_id uuid,service_id uuid,service_revision_id uuid,assignee_user_id uuid);
        create index relationship_services_relationship_idx on relationship_services(workspace_id,relationship_id);
        create table relationship_service_instances(workspace_id uuid,id uuid,relationship_id uuid,service_id uuid,service_revision_id uuid,assignee_user_id uuid,stage text,disposition text,import_id uuid,primary key(workspace_id,id));
        create index service_instances_relationship_stage_idx on relationship_service_instances(workspace_id,relationship_id,stage,id);
        create index service_instances_active_assignee_idx on relationship_service_instances(workspace_id,assignee_user_id,stage,id)
          where disposition='active' and stage in ('negotiating','awaiting_payment','onboarding','setup','maintenance');
        create index service_instances_revision_idx on relationship_service_instances(workspace_id,service_revision_id);
        create table workspace_member_service_access(workspace_id uuid,user_id uuid,service_id uuid,primary key(workspace_id,user_id,service_id));
        create table appointment_setting_setup_assignees(workspace_id uuid,relationship_id uuid,user_id uuid,primary key(workspace_id,relationship_id,user_id));
        create index appointment_setting_setup_assignees_user_idx on appointment_setting_setup_assignees(workspace_id,user_id,relationship_id);
        create table client_portal_secure.ghl_connections(workspace_id uuid,relationship_id uuid,account_type text,vault_secret_id uuid,location_id text,location_name text,refreshed_at timestamptz,ready_at timestamptz,last_error text,lease_until timestamptz,primary key(workspace_id,relationship_id));
        create function workspace_role_for_user(p_workspace uuid,p_user uuid) returns text language sql stable security definer as $$select role from workspace_memberships where workspace_id=p_workspace and user_id=p_user$$;
        create function fixture_uuid(p_n integer) returns uuid language sql immutable as $$select ('00000000-0000-4000-8000-'||lpad(p_n::text,12,'0'))::uuid$$;
        insert into workspaces values('${workspace}','active');
        insert into workspace_memberships select '${workspace}',fixture_uuid(100+n),'staff' from generate_series(0,99) n;
        insert into workspace_memberships values('${workspace}','${uuid(5001)}','staff'),('${workspace}','${uuid(5002)}','staff'),('${workspace}','${uuid(5003)}','owner'),('${workspace}','${uuid(5004)}','admin');
        insert into onboarding_service_revisions select '${workspace}',fixture_uuid(1000+n),fixture_uuid(2000+n),case when n%5=0 then '{"templateId":"appointment-setting"}'::jsonb else '{}'::jsonb end from generate_series(0,29) n;
        insert into workspace_member_service_access select '${workspace}',fixture_uuid(100+u),fixture_uuid(2000+s) from generate_series(0,99) u cross join generate_series(0,29) s;
        insert into workspace_member_service_access select '${workspace}',fixture_uuid(u),fixture_uuid(2000+s) from generate_series(5001,5002) u cross join generate_series(0,29) s;
        insert into appointment_setting_setup_assignees select '${workspace}',fixture_uuid(10000+n*5),'${uuid(5001)}' from generate_series(0,4) n;
    `)
    const transfer = await migration('20261005220000_service_assignee_transfer.sql')
    await db.exec(transfer.slice(transfer.indexOf('create function public.current_appointment_service_assignments('),transfer.indexOf('create or replace function public.appointment_setting_service_is_available(')))
    await db.exec(transfer.slice(transfer.indexOf('create function public.service_assignee_can_setup_client('),transfer.indexOf('create function public.read_assigned_appointment_services(')))
    const original = await migration('20260922191500_fix_client_connections_list.sql')
    const definition = original.slice(original.indexOf('create or replace function'), original.indexOf('\nrevoke all'))
    const oldGrant = `exists (
                select 1 from public.appointment_setting_setup_assignees assignment
                where assignment.workspace_id=p_workspace_id and assignment.relationship_id=relationship.id and assignment.user_id=p_user_id
            )`
    assert.ok(definition.includes(oldGrant))
    await db.exec(definition.replace('public.manage_client_ghl_connection(', 'public.fixture_baseline_list('))
    const oldCommandGrant = `exists (
        select 1 from public.appointment_setting_setup_assignees assignment
        where assignment.workspace_id=p_workspace_id and assignment.relationship_id=p_relationship_id and assignment.user_id=p_user_id
    )`
    const helperDefinition = definition.replace(oldGrant, 'public.service_assignee_can_setup_client(p_workspace_id,p_user_id,relationship.id)').replace(oldCommandGrant, `(${oldCommandGrant} or public.service_assignee_can_setup_client(p_workspace_id,p_user_id,p_relationship_id))`)
    await db.exec(helperDefinition.replace('public.manage_client_ghl_connection(', 'public.fixture_helper_list('))

    const actorEligible = `with eligible as (
                select instance.relationship_id from public.relationship_service_instances instance
                join public.onboarding_service_revisions revision on revision.workspace_id=instance.workspace_id and revision.id=instance.service_revision_id
                join public.workspace_member_service_access access on access.workspace_id=instance.workspace_id and access.service_id=instance.service_id and access.user_id=p_user_id
                where instance.workspace_id=p_workspace_id and instance.assignee_user_id=p_user_id
                  and instance.import_id is null and instance.disposition='active' and instance.stage in ('onboarding','setup','maintenance')
                  and coalesce(revision.definition->>'templateId',revision.definition->>'template_id')='appointment-setting'
                union
                select assignment.relationship_id from public.appointment_setting_setup_assignees assignment
                where assignment.workspace_id=p_workspace_id and assignment.user_id=p_user_id
                  and (exists(select 1 from public.relationship_service_instances instance
                    join public.onboarding_service_revisions revision on revision.workspace_id=instance.workspace_id and revision.id=instance.service_revision_id
                    where instance.workspace_id=p_workspace_id and instance.relationship_id=assignment.relationship_id
                      and instance.import_id is null and instance.disposition<>'cancelled'
                      and coalesce(revision.definition->>'templateId',revision.definition->>'template_id')='appointment-setting')
                  or exists(select 1 from public.relationship_services service
                    join public.onboarding_service_revisions revision on revision.workspace_id=service.workspace_id and revision.id=service.service_revision_id
                    where service.workspace_id=p_workspace_id and service.relationship_id=assignment.relationship_id
                      and coalesce(revision.definition->>'templateId',revision.definition->>'template_id')='appointment-setting'))
            )`
    const listStart = definition.indexOf('        return coalesce((')
    const listEnd = definition.indexOf("        ), '[]'::jsonb);", listStart) + "        ), '[]'::jsonb);".length
    const originalList = definition.slice(listStart, listEnd)
    const eligibleStart = originalList.indexOf('with eligible as (')
    const eligibleEnd = originalList.indexOf('\n            select jsonb_agg')
    const actorList = originalList.slice(0, eligibleStart) + actorEligible + originalList.slice(eligibleEnd).replace(`where v_role in ('owner','admin') or ${oldGrant}`, '')
    const prototype = helperDefinition.replace('public.manage_client_ghl_connection(', 'public.fixture_actor_list(').replace("    if p_action = 'list' then", `    if p_action = 'list' and v_role not in ('owner','admin') then\n${actorList}\n    end if;\n\n    if p_action = 'list' then`)
    const commandStart = "    if p_relationship_id is null or p_action not in"
    assert.equal(prototype.slice(prototype.indexOf(commandStart)), helperDefinition.slice(helperDefinition.indexOf(commandStart)))
    const prototypePath = '/tmp/betelgeze-client-list-actor-prototype.sql'
    await writeFile(prototypePath, prototype)
    await db.exec(prototype)
    await db.exec(definition)
    const installerStart=transfer.indexOf('-- Preserve the existing list projection')
    const installerEnd=transfer.indexOf('create table public.service_assignee_transfer_receipts')
    assert.ok(installerStart>=0 && installerEnd>installerStart)
    await db.exec(transfer.slice(installerStart,installerEnd))
    const functionDefinition=async name=>(await one('select pg_get_functiondef($1::regprocedure) definition',[`public.${name}(uuid,uuid,text,uuid,uuid,text,text,text,text,jsonb,text)`])).definition
    const installed=await functionDefinition('manage_client_ghl_connection'),actorDefinition=await functionDefinition('fixture_actor_list')
    const staffBranch=text=>text.slice(text.indexOf("    if p_action = 'list' and v_role not in"),text.indexOf("    if p_action = 'list' then"))
    assert.equal(staffBranch(installed),staffBranch(actorDefinition))
    assert.ok(installed.includes(originalList), 'Existing owner/admin list projection must remain verbatim')
    assert.equal(installed.slice(installed.indexOf(commandStart)),actorDefinition.slice(actorDefinition.indexOf(commandStart)))
    const evidence = { engine: 'Isolated PGlite PostgreSQL/WASM', timing: 'EXPLAIN ANALYZE Execution Time; milliseconds; warmed alternating calls', prototypePath, results: [], plans: [], cohorts: [] }
    console.log(JSON.stringify({kind:'metadata',engine:evidence.engine,timing:verifyOnly?'Validation only; no timing measurements in this run':evidence.timing,fixture:'Synthetic active clients, 4 instances per client, 100 staff, 30 service revisions, existing index shapes only',migrationSha256:createHash('sha256').update(transfer).digest('hex'),actualInstallerApplied:true,installedStaffBranchIdentical:true,staffBranchSha256:createHash('sha256').update(staffBranch(installed)).digest('hex'),ownerAdminProjectionUnchanged:true,scalarCommandTailIdentical:true}))
    const functionName=variant=>variant==='installed'?'manage_client_ghl_connection':`fixture_${variant}_list`
    for (const relationshipCount of (verifyOnly?[]:[250, 2500])) {
        await db.exec(`truncate relationship_service_instances,relationships;
          insert into relationships select '${workspace}',fixture_uuid(10000+n),'active','retention','Client '||n,null from generate_series(0,${relationshipCount-1}) n;
          insert into relationship_service_instances select '${workspace}',fixture_uuid(100000+n),fixture_uuid(10000+n/4),fixture_uuid(2000+n%30),fixture_uuid(1000+n%30),fixture_uuid(100+n%100),'setup','active',null from generate_series(0,${relationshipCount*4-1}) n;
          analyze;`)
        for (const [cohort,userNumber] of [['explicit',5001],['denied',5002],['derived',105],['owner',5003]]) {
            const user = uuid(userNumber)
            const expected = await one("select fixture_baseline_list($1,$2,'list') baseline,fixture_helper_list($1,$2,'list') helper,fixture_actor_list($1,$2,'list') actor,manage_client_ghl_connection($1,$2,'list') installed",[workspace,user])
            assert.deepEqual(expected.actor, expected.helper)
            assert.deepEqual(expected.installed,expected.actor)
            if(cohort!=='derived') assert.deepEqual(expected.helper, expected.baseline)
            const values = { baseline: [], helper: [], actor: [], installed: [] }
            for (const variant of Object.keys(values)) for(let warm=0;warm<3;warm++) await one(`select ${functionName(variant)}($1,$2,'list')`,[workspace,user])
            for(let round=0;round<11;round++) for (const variant of (round%2?['installed','actor','helper','baseline']:['baseline','helper','actor','installed'])) {
                const explain = await one(`explain(analyze,buffers,format json) select ${functionName(variant)}($1,$2,'list')`,[workspace,user])
                values[variant].push(explain['QUERY PLAN'][0]['Execution Time'])
            }
            const median = values => [...values].sort((a,b)=>a-b)[Math.floor(values.length/2)]
            const result = {relationshipCount,instanceCount:relationshipCount*4,cohort,rows:expected.helper.length,samples:11,callsPerSample:1,baselineMs:median(values.baseline),helperMs:median(values.helper),actorMs:median(values.actor),installedMs:median(values.installed), raw: values}
            evidence.results.push(result)
            console.log(JSON.stringify({...result,raw:undefined}))
        }
    }
    // Extract plans for the relational query so the helper filter is visible.
    for (const [variant,query] of (verifyOnly?[]:[['helper',originalList.replace(oldGrant,'public.service_assignee_can_setup_client(p_workspace_id,p_user_id,relationship.id)')],['actor',actorList]])) {
        const sql = query.trim().replace(/^return /,'select ').replaceAll('p_workspace_id',`'${workspace}'::uuid`).replaceAll('p_user_id',`'${uuid(5002)}'::uuid`).replaceAll('v_role',"'staff'::text")
        const plan = await one(`explain(analyze,buffers,format json) ${sql}`)
        evidence.plans.push({variant,deniedPlan:plan['QUERY PLAN']})
        console.log(JSON.stringify({variant,deniedExecutionMs:plan['QUERY PLAN'][0]['Execution Time'],sharedHits:plan['QUERY PLAN'][0].Plan['Shared Hit Blocks']}))
    }
    await db.exec(`truncate relationship_service_instances,relationship_services,relationships,appointment_setting_setup_assignees;
      insert into relationships select '${workspace}',fixture_uuid(20000+n),case when n=10 then 'archived' else 'active' end,'retention','Cohort '||n,null from generate_series(1,17) n;
      insert into relationship_service_instances
      select '${workspace}',fixture_uuid(30000+n),fixture_uuid(20000+n),fixture_uuid(case when n=11 then 2001 when n=16 then 2005 else 2000 end),fixture_uuid(case when n=11 then 1001 when n=16 then 1005 else 1000 end),fixture_uuid(case when n=14 then 101 else 105 end),
        case n when 1 then 'onboarding' when 3 then 'maintenance' when 4 then 'negotiating' when 5 then 'awaiting_payment' when 6 then 'completed' else 'setup' end,
        case when n=7 then 'paused' when n in(8,13) then 'cancelled' else 'active' end,case when n=9 then fixture_uuid(40000) else null end
      from generate_series(1,17) n where n<>12;
      insert into relationship_service_instances select workspace_id,fixture_uuid(39999),relationship_id,service_id,service_revision_id,assignee_user_id,stage,disposition,import_id from relationship_service_instances where id=fixture_uuid(30015);
      insert into relationship_services select '${workspace}',fixture_uuid(20000+n),fixture_uuid(2000),fixture_uuid(1000),fixture_uuid(105) from unnest(array[12,13]) n;
      insert into appointment_setting_setup_assignees select '${workspace}',fixture_uuid(20000+n),fixture_uuid(5001) from generate_series(1,17) n;
      delete from workspace_member_service_access where workspace_id='${workspace}' and user_id=fixture_uuid(105) and service_id=fixture_uuid(2005);
      insert into client_portal_secure.ghl_connections(workspace_id,relationship_id,account_type,vault_secret_id,location_id,location_name) values('${workspace}',fixture_uuid(20002),'client_account',fixture_uuid(49999),'fixture-location','Fixture location');
      analyze;`)
    const explicitNumbers=[1,2,3,4,5,6,7,12,13,14,15,16,17]
    const derivedNumbers=[1,2,3,15,17]
    for(const [cohort,userNumber,expectedNumbers] of [['explicit_all_states',5001,explicitNumbers],['current_derived_states',105,derivedNumbers],['eligible_unassigned',5002,[]],['owner_all_states',5003,explicitNumbers],['admin_all_states',5004,explicitNumbers]]) {
        const value = await one("select fixture_helper_list($1,$2,'list') helper,fixture_actor_list($1,$2,'list') actor,manage_client_ghl_connection($1,$2,'list') installed",[workspace,uuid(userNumber)])
        assert.deepEqual(value.actor,value.helper)
        assert.deepEqual(value.installed,value.actor)
        assert.deepEqual(value.actor.map(row=>row.relationshipId).sort(),expectedNumbers.map(n=>uuid(20000+n)).sort(),cohort)
        evidence.cohorts.push({cohort,rows:value.actor.length,equal:true,installedEqual:true})
        console.log(JSON.stringify(evidence.cohorts.at(-1)))
    }
    await db.exec(`update workspaces set status='inactive' where id='${workspace}'`)
    assert.deepEqual((await one("select fixture_helper_list($1,$2,'list') helper,fixture_actor_list($1,$2,'list') actor,manage_client_ghl_connection($1,$2,'list') installed",[workspace,uuid(105)])),{helper:{failure:'access'},actor:{failure:'access'},installed:{failure:'access'}})
    evidence.cohorts.push({cohort:'inactive_workspace',equal:true,installedEqual:true})
    evidence.commandTailUnchanged=true
    const evidencePath=verifyOnly?'/tmp/betelgeze-client-list-installed-verification.json':'/tmp/betelgeze-client-list-access-evidence.json'
    await writeFile(evidencePath,JSON.stringify(evidence,null,2))
    console.log(JSON.stringify({evidencePath,prototypePath,commandTailUnchanged:true}))
} finally { await db.close() }
