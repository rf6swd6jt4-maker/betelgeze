import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {repositoryRoot} from './pglite-fixture.mjs'

export async function validateServiceWorkChat({db,id,w,admin,staff,revision,fixture}) {
 const one=async(sql,args=[])=>(await db.query(sql,args)).rows[0]
 await db.exec(`create table workspace_teams(id uuid primary key default gen_random_uuid(),workspace_id uuid,relationship_id uuid,name text,kind text,created_by uuid,archived_at timestamptz,unique(workspace_id,relationship_id));
 create table workspace_team_members(workspace_id uuid,team_id uuid,user_id uuid,added_by uuid,primary key(team_id,user_id));
 create table workspace_native_conversations(id uuid primary key default gen_random_uuid(),workspace_id uuid,team_id uuid,kind text,created_by uuid,archived_at timestamptz,unique(workspace_id,team_id));
 create function create_relationship_delivery_team(p_workspace_id uuid,p_relationship_id uuid) returns uuid language plpgsql as $$
 declare v_team uuid;
 begin
  select id into v_team from workspace_teams where workspace_id=p_workspace_id and relationship_id=p_relationship_id;
  if v_team is null then
   insert into workspace_teams(workspace_id,relationship_id,name,kind) values(p_workspace_id,p_relationship_id,'Team','relationship') returning id into v_team;
  end if;
  return v_team;
 end $$;`)
 const already=await fixture(9900,false)
 await db.exec(await readFile(`${repositoryRoot}/supabase/migrations/20260920150000_service_work_and_fulfilment_chat.sql`,'utf8'))
 assert.equal((await one('select count(*)::int n from workspace_teams where relationship_id=$1',[already])).n,1)
 assert.equal((await one('select count(*)::int n from sop_work_requests where instance_id=$1',[already])).n,0)
 const real=id(9901),request=id(9902)
 await db.query(`insert into relationships(id,workspace_id,source_metadata,business_name,primary_person_name,seller_user_id,fulfilment_manager_user_id,lifecycle_phase)
  values($1,$2,'{"is_test":false}','Real client','Andy',$3,$3,'potential_client')`,[real,w,admin])
 await db.query('update sop_service_sources set enabled=true where workspace_id=$1 and service_id=$2',[w,revision])
 const add=[w,real,admin,request,revision,revision,'already_onboarded','setup',staff,true]
 const saved=(await one('select add_relationship_service_with_sop($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) value',add)).value
 assert.equal(saved.generation,true)
 assert.equal((await one('select count(*)::int n from relationship_service_instances where id=$1',[saved.id])).n,1)
 assert.equal((await one('select status from sop_work_requests where instance_id=$1',[saved.id])).status,'pending')
 const team=(await one('select id from workspace_teams where relationship_id=$1',[real])).id
 const conversation=(await one("select id from workspace_native_conversations where team_id=$1 and kind='team'",[team])).id
 assert.equal((await one('select count(*)::int n from workspace_team_members where team_id=$1',[team])).n,2)
 const run=(await one('select accept_sop_work_request($1,$2,100) id',[saved.id,'gpt-5.4-mini'])).id
 assert.ok(run)
 const job=await one('select * from claim_sop_work($1)',[run])
 assert.ok((await one('select prepare_sop_work($1,$2) packet',[run,job.lease_token])).packet)
 const newcomer=id(9910)
 await db.query('insert into auth.users(id) values($1)',[newcomer])
 await db.query("insert into workspace_memberships(workspace_id,user_id,role) values($1,$2,'staff')",[w,newcomer])
 await db.query('insert into workspace_member_service_access(workspace_id,user_id,service_id) values($1,$2,$3)',[w,newcomer,revision])
 await db.query('select change_relationship_service_with_sop($1,$2,$3,$4,$5,1,$6,$7,$8,$9,true)',[w,real,saved.id,admin,id(9911),'setup','active',newcomer,'Assign additional fulfilment staff'])
 assert.equal((await one('select count(*)::int n from workspace_teams where relationship_id=$1',[real])).n,1)
 assert.equal((await one('select id from workspace_native_conversations where team_id=$1',[team])).id,conversation)
 assert.equal((await one('select count(*)::int n from workspace_team_members where team_id=$1 and user_id=$2',[team,newcomer])).n,1)
 assert.equal((await one('select count(*)::int n from sop_work_requests where instance_id=$1',[saved.id])).n,1)
 const manager=id(9912)
 await db.query('insert into auth.users(id) values($1)',[manager])
 await db.query("insert into workspace_memberships(workspace_id,user_id,role) values($1,$2,'staff')",[w,manager])
 await db.query('update relationships set fulfilment_manager_user_id=$1 where id=$2',[manager,real])
 assert.equal((await one('select count(*)::int n from workspace_team_members where team_id=$1 and user_id=$2',[team,manager])).n,1)
 assert.equal((await one('select id from workspace_native_conversations where team_id=$1',[team])).id,conversation)
 const complete=id(9920)
 await db.query("insert into relationships(id,workspace_id,business_name,primary_person_name,seller_user_id,fulfilment_manager_user_id) values($1,$2,'Past client','Pat',$3,$3)",[complete,w,admin])
 const completed=(await one('select add_relationship_service_with_sop($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) value',[w,complete,admin,id(9921),revision,revision,'already_onboarded','completed',staff,true])).value
 assert.equal(completed.generation,false)
 assert.equal((await one('select count(*)::int n from workspace_teams where relationship_id=$1',[complete])).n,0)
 assert.equal((await one('select count(*)::int n from sop_work_requests where instance_id=$1',[completed.id])).n,0)
 console.log('PASS active real relationships: durable SOP work, one Team chat, new assignee and manager membership, completed exclusion and bounded backfill')
}
