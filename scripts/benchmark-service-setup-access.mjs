// Isolated PostgreSQL/WASM comparison; synthetic indexed populations only.
// This measures database predicates, not shell/network/device latency.
import { readFile } from 'node:fs/promises'
import { PGlite, repositoryRoot } from './pglite-fixture.mjs'

const db = new PGlite()
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const workspace = uuid(1)
try {
  await db.exec(`
    create schema auth;
    create function auth.uid() returns uuid language sql as $$select null::uuid$$;
    create table workspaces(id uuid primary key,status text);
    create table workspace_memberships(workspace_id uuid,user_id uuid,role text,primary key(workspace_id,user_id));
    create table relationships(workspace_id uuid,id uuid,status text,lifecycle_phase text,primary key(workspace_id,id));
    create table onboarding_service_revisions(workspace_id uuid,id uuid,service_id uuid,definition jsonb,primary key(workspace_id,id));
    create table relationship_services(workspace_id uuid,relationship_id uuid,service_id uuid,service_revision_id uuid,assignee_user_id uuid);
    create table relationship_service_instances(workspace_id uuid,id uuid,relationship_id uuid,service_id uuid,service_revision_id uuid,assignee_user_id uuid,stage text,disposition text,import_id uuid,primary key(workspace_id,id));
    create index service_instances_relationship_stage_idx on relationship_service_instances(workspace_id,relationship_id,stage,id);
    create index service_instances_active_assignee_idx on relationship_service_instances(workspace_id,assignee_user_id,stage,id)
      where disposition='active' and stage in ('negotiating','awaiting_payment','onboarding','setup','maintenance');
    create index service_instances_revision_idx on relationship_service_instances(workspace_id,service_revision_id);
    create table workspace_member_service_access(workspace_id uuid,user_id uuid,service_id uuid,primary key(workspace_id,user_id,service_id));
    create table appointment_setting_setup_assignees(workspace_id uuid,relationship_id uuid,user_id uuid,primary key(workspace_id,relationship_id,user_id));
    create index appointment_setting_setup_assignees_user_idx on appointment_setting_setup_assignees(workspace_id,user_id,relationship_id);
    create function workspace_role_for_user(p_workspace uuid,p_user uuid) returns text language sql stable security definer as $$
      select role from workspace_memberships where workspace_id=p_workspace and user_id=p_user$$;
    create function fixture_uuid(p_n integer) returns uuid language sql immutable as $$select ('00000000-0000-4000-8000-'||lpad(p_n::text,12,'0'))::uuid$$;
    insert into workspaces values('${workspace}','active');
    insert into workspace_memberships select '${workspace}',fixture_uuid(100+n),'staff' from generate_series(0,99) n;
    insert into workspace_memberships values('${workspace}','${uuid(5001)}','staff'),('${workspace}','${uuid(5002)}','staff');
    insert into onboarding_service_revisions select '${workspace}',fixture_uuid(1000+n),fixture_uuid(2000+n),
      case when n%5=0 then '{"templateId":"appointment-setting"}'::jsonb else '{}'::jsonb end from generate_series(0,29) n;
    insert into workspace_member_service_access select '${workspace}',fixture_uuid(100+u),fixture_uuid(2000+s) from generate_series(0,99) u cross join generate_series(0,29) s;
    insert into appointment_setting_setup_assignees values('${workspace}','${uuid(10000)}','${uuid(5001)}');
  `)
  const sql = await readFile(`${repositoryRoot}/supabase/migrations/20261005220000_service_assignee_transfer.sql`,'utf8')
  await db.exec(sql.slice(sql.indexOf('create function public.current_appointment_service_assignments('),sql.indexOf('create or replace function public.appointment_setting_service_is_available(')))
  await db.exec(sql.slice(sql.indexOf('create function public.service_assignee_can_setup_client('),sql.indexOf('create function public.read_assigned_appointment_services(')))
  await db.exec(`
    create function fixture_measure(p_workspace uuid,p_user uuid,p_candidate boolean,p_count integer) returns double precision language plpgsql as $$
    declare started timestamptz; n integer; value boolean;
    begin
      started:=clock_timestamp();
      if p_candidate then
        for n in 1..p_count loop select service_assignee_can_setup_client(p_workspace,p_user) into value; end loop;
      else
        for n in 1..p_count loop select exists(select 1 from appointment_setting_setup_assignees assignment where assignment.workspace_id=p_workspace and assignment.user_id=p_user) into value; end loop;
      end if;
      return extract(epoch from clock_timestamp()-started)*1000/p_count;
    end$$;
  `)
  const cohorts=[['explicit_grant',5001],['derived_service',105],['nonappointment_assignments',101],['no_assignments',5002]]
  const results=[]
  for (const instanceCount of [1000,10000,100000]) {
    await db.exec(`
      truncate relationship_service_instances,relationships;
      insert into relationships select '${workspace}',fixture_uuid(10000+n),'active','retention' from generate_series(0,${instanceCount/4-1}) n;
      insert into relationship_service_instances select '${workspace}',fixture_uuid(100000+n),fixture_uuid(10000+n/4),fixture_uuid(2000+n%30),fixture_uuid(1000+n%30),fixture_uuid(100+n%100),'setup','active',null from generate_series(0,${instanceCount-1}) n;
      analyze;
    `)
    for (const [cohort,userNumber] of cohorts) {
      const user=uuid(userNumber)
      await db.query('select fixture_measure($1,$2,$3,50)',[workspace,user,false])
      await db.query('select fixture_measure($1,$2,$3,50)',[workspace,user,true])
      const old=[],candidate=[]
      for (let round=0;round<15;round++) {
        for (const variant of (round%2 ? [true,false] : [false,true])) {
          const value=(await db.query('select fixture_measure($1,$2,$3,1000) ms',[workspace,user,variant])).rows[0].ms
          ;(variant ? candidate : old).push(value)
        }
      }
      const median=values=>[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)]
      const result={instanceCount,cohort,samples:15,callsPerSample:1000,baselineMs:median(old),candidateMs:median(candidate),deltaMs:median(candidate)-median(old)}
      results.push(result)
      console.log(JSON.stringify(result))
    }
  }
  const plans=await db.query(`explain (analyze,buffers,format json)
    select 1 from relationship_service_instances i
    join onboarding_service_revisions v on v.workspace_id=i.workspace_id and v.id=i.service_revision_id
    join relationships r on r.workspace_id=i.workspace_id and r.id=i.relationship_id and r.status<>'archived'
    join workspace_member_service_access e on e.workspace_id=i.workspace_id and e.service_id=i.service_id and e.user_id='${uuid(101)}'
    where i.workspace_id='${workspace}' and i.assignee_user_id='${uuid(101)}' and i.disposition='active'
      and i.stage in ('onboarding','setup','maintenance') and i.import_id is null
      and coalesce(v.definition->>'templateId',v.definition->>'template_id')='appointment-setting' limit 1`)
  console.log(JSON.stringify({largestNoGrantPlan:plans.rows[0]['QUERY PLAN']}))
} finally { await db.close() }
