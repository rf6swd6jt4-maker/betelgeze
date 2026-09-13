import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { repositoryRoot } from './pglite-fixture.mjs'
export async function validateSessionReadiness({db,q,one,w,owner,seller,staff,unrelated,relationship,uuid,pass}) {
 await db.exec(`
 create unique index fixture_native_work_unique on work_items(workspace_id,native_kind,native_key) where native_kind is not null and native_key is not null;
 alter table relationship_onboarding_sessions add column if not exists original_source_sale_id uuid,add column if not exists restarted_from_session_id uuid;
 alter table relationship_onboarding_session_steps add column if not exists superseded_at timestamptz,add column if not exists source_step_id uuid;
 alter table workspaces add column if not exists slug text;
 alter table relationships add column if not exists started_onboarding_at timestamptz;
 alter table work_items add column if not exists workflow_required boolean default true;
 alter table assets add column if not exists metadata jsonb default '{}',add column if not exists updated_at timestamptz default now(),add column if not exists native_kind text,add column if not exists native_key text;
 create table relationship_onboarding_session_blocks(id uuid primary key default gen_random_uuid(),workspace_id uuid,session_id uuid,session_step_id uuid,source_block_id uuid,kind text,sort_order integer,definition jsonb,required boolean);
 create table onboarding_block_requirements(workspace_id uuid,session_block_id uuid);
 create table workspace_admin_activity(workspace_id uuid,entity_type text,entity_id text,event_key text,actor_kind text);
 create table asset_relationships(workspace_id uuid,relationship_id uuid,asset_id uuid);
 create table asset_work_items(workspace_id uuid,work_item_id uuid,asset_id uuid);
 create table workspace_teams(id uuid primary key default gen_random_uuid(),workspace_id uuid,relationship_id uuid,name text,kind text,created_by uuid,unique(workspace_id,relationship_id));
 create table workspace_team_members(workspace_id uuid,team_id uuid,user_id uuid,added_by uuid,primary key(team_id,user_id));
 create table relationship_team_events(workspace_id uuid,relationship_id uuid,actor_user_id uuid,event_type text,details jsonb);
 drop function create_relationship_delivery_team(uuid,uuid);
 create function complete_onboarding_session_step(p_workspace_id uuid,p_session_id uuid,p_session_step_id uuid,p_work_item_id uuid,p_session_token text,p_correlation_id uuid default null,p_idempotency_key text default null,p_form_response jsonb default null,p_form_title text default null,p_form_key text default null,p_uploads jsonb default '[]') returns jsonb language plpgsql as $$ begin
 if not exists(select 1 from relationship_onboarding_sessions where workspace_id=p_workspace_id and id=p_session_id and session_token=p_session_token and token_revoked_at is null and status='active') then raise exception 'Invalid session'; end if;
 update work_items set status='done',actual_completed_at=now() where id=p_work_item_id and workspace_id=p_workspace_id;insert into workspace_admin_activity values(p_workspace_id,'work_item',p_work_item_id::text,'onboarding.step.completed','client');return '{}';end $$;
 `)
 const teamSource=await readFile(`${repositoryRoot}/supabase/migrations/20260909100000_client_delivery_teams.sql`,'utf8')
 await db.exec(teamSource.slice(teamSource.indexOf('create function public.create_relationship_delivery_team('),teamSource.indexOf('-- Import existing sold clients')))
 await db.exec(await readFile(`${repositoryRoot}/supabase/migrations/20260913150000_onboarding_session_readiness.sql`,'utf8'))
 await db.exec('create trigger enforce_onboarding_block_requirements before update of status on work_items for each row execute function enforce_onboarding_block_requirements()')
 pass('SS04 migration compiles against the existing service/session foundation')
 const sessions=await q("select id,session_token,source_sale_id from relationship_onboarding_sessions where workspace_id=$1 and relationship_id=$2 and status='active' order by created_at",[w,relationship])
 assert(sessions.length>=2)
 const a=sessions[0],b=sessions[1]
 const welcome=uuid(1500),welcomeRevision=uuid(1501)
 await q("insert into onboarding_modules(id,workspace_id,internal_code,status) values($1,$2,'system-welcome','active')",[welcome,w])
 await q("insert into onboarding_module_revisions(id,workspace_id,module_id,status,definition) values($1,$2,$3,'published','{}')",[welcomeRevision,w,welcome])
 const welcomeSteps=[]
 for(const [index,session] of [a,b].entries()) {
  await q('update relationship_onboarding_session_steps set sort_order=sort_order+100 where session_id=$1',[session.id])
  const module=uuid(1510+index),step=uuid(1520+index),work=uuid(1530+index)
  await q("insert into relationship_onboarding_session_modules(id,workspace_id,session_id,module_id,module_revision_id,source_kind,title,sort_order) values($1,$2,$3,$4,$5,'mandatory','Welcome',0)",[module,w,session.id,welcome,welcomeRevision])
  await q("insert into relationship_onboarding_session_steps(id,workspace_id,session_id,session_module_id,module_revision_id,kind,title,sort_order,is_actionable) values($1,$2,$3,$4,$5,'video','Welcome',0,true)",[step,w,session.id,module,welcomeRevision])
  await q("insert into work_items(id,workspace_id,title,status,native_kind,native_key,metadata) values($1,$2,'Welcome','todo','onboarding_step',$3,$4)",[work,w,session.id+':step:'+step,{session_id:session.id,session_step_id:step}]);welcomeSteps.push({module,step,work})
 }
 // A two-step welcome needs proof for both steps; completion counts alone are insufficient.
 const welcomeSecond=uuid(1540),welcomeSecondWork=uuid(1541),requiredWelcomeBlock=uuid(1542)
 await q("insert into relationship_onboarding_session_steps(id,workspace_id,session_id,session_module_id,module_revision_id,kind,title,sort_order,is_actionable) values($1,$2,$3,$4,$5,'video','Welcome part two',1,true)",[welcomeSecond,w,a.id,welcomeSteps[0].module,welcomeRevision])
 await q("insert into work_items(id,workspace_id,title,status,native_kind,native_key,metadata) values($1,$2,'Welcome part two','todo','onboarding_step',$3,$4)",[welcomeSecondWork,w,a.id+':step:'+welcomeSecond,{session_id:a.id,session_step_id:welcomeSecond}])
 await q("insert into relationship_onboarding_session_blocks(id,workspace_id,session_id,session_step_id,kind,required) values($1,$2,$3,$4,'video',true)",[requiredWelcomeBlock,w,b.id,welcomeSteps[1].step])
 const reuse=async session=>(await one('select read_onboarding_session_reuse($1,$2,$3) result',[w,session.id,session.session_token])).result
 assert.equal((await reuse(a)).canSkipWelcome,false);assert.equal((await reuse(b)).canSkipWelcome,false)
 await assert.rejects(q('select skip_previously_completed_welcome($1,$2,$3,$4)',[w,b.id,b.session_token,welcomeSteps[1].step]),/Complete the welcome/)
 await q('select complete_onboarding_session_step($1,$2,$3,$4,$5)',[w,a.id,welcomeSteps[0].step,welcomeSteps[0].work,a.session_token])
 assert.equal((await reuse(b)).canSkipWelcome,false)
 await q("update work_items set status='done',actual_completed_at=now() where id=$1",[welcomeSecondWork])
 await q('select record_onboarding_welcome_completion($1,$2)',[w,a.id]);assert.equal((await reuse(b)).canSkipWelcome,false)
 await q('select complete_onboarding_session_step($1,$2,$3,$4,$5)',[w,a.id,welcomeSecond,welcomeSecondWork,a.session_token])
 assert.equal((await reuse(b)).canSkipWelcome,true)
 await q('update relationship_onboarding_sessions set welcome_test_skipped=true,welcome_completed_at=null where id=$1',[a.id]);assert.equal((await reuse(b)).canSkipWelcome,false)
 await q('update relationship_onboarding_sessions set welcome_test_skipped=false where id=$1',[a.id]);await q('select record_onboarding_welcome_completion($1,$2)',[w,a.id]);
 pass('two unfinished sessions do not unlock Skip; real completion does; test shortcuts do not')
 for(const role of ['anon','authenticated'])assert.equal((await one("select has_function_privilege($1,'skip_previously_completed_welcome(uuid,uuid,text,uuid)','EXECUTE') allowed",[role])).allowed,false)
 pass('welcome reuse commands remain trusted-server-only') // A skipped welcome retains its provenance and cannot become new evidence.
 await q("update client_sales set status='paid',consent_confirmed_at=now() where id=$1",[b.source_sale_id])
 await q('select skip_previously_completed_welcome($1,$2,$3,$4)',[w,b.id,b.session_token,welcomeSteps[1].step])
 await q('select skip_previously_completed_welcome($1,$2,$3,$4)',[w,b.id,b.session_token,welcomeSteps[1].step])
 const skipped=await one('select welcome_completed_at,welcome_skipped_from_session_id from relationship_onboarding_sessions where id=$1',[b.id])
 assert.equal(skipped.welcome_completed_at,null);assert.equal(skipped.welcome_skipped_from_session_id,a.id)
 await q('select record_onboarding_welcome_completion($1,$2)',[w,b.id]);assert.equal((await one('select welcome_completed_at from relationship_onboarding_sessions where id=$1',[b.id])).welcome_completed_at,null)
 await assert.rejects(q('select skip_previously_completed_welcome($1,$2,$3,$4)',[w,b.id,'wrong-token',welcomeSteps[1].step]),/cannot be skipped/)
 pass('Skip is replay-safe, token-scoped and never manufactures genuine completion evidence')
 // Completing a second sale adds members to exactly the same relationship team.
 await q('update client_sales set status=status where workspace_id=$1 and relationship_id=$2 and service_scope=\'selected_services\'',[w,relationship])
 assert.equal((await one('select count(*) n from workspace_teams where workspace_id=$1 and relationship_id=$2',[w,relationship])).n,1)
 const team=(await one('select id from workspace_teams where workspace_id=$1 and relationship_id=$2',[w,relationship])).id
 assert((await q('select user_id from workspace_team_members where team_id=$1',[team])).some(row=>row.user_id===staff))
 await q('insert into workspace_team_members values($1,$2,$3,$4) on conflict do nothing',[w,team,unrelated,owner])
 await q('update client_sales set status=status where id=$1',[b.source_sale_id]);assert((await q('select user_id from workspace_team_members where team_id=$1',[team])).some(row=>row.user_id===unrelated))
 const staffScope=(await one('select read_selected_service_session_access($1,$2,$3) result',[w,[a.id,b.id],unrelated])).result
 assert.deepEqual(staffScope.sessionIds,[])
 pass('sales reuse one team, preserve existing members, and team membership alone grants no session access')

 // Review readiness belongs to instances, not the whole session.
 const instances=await q('select instance_id from service_instance_sessions where session_id=$1 order by instance_id',[b.id]);assert(instances.length>=2)

 const isolatedSteps=[]
 for(const [index,instance] of instances.slice(0,2).entries()) {
  const m=uuid(1600+index),st=uuid(1610+index)
  const moduleId=uuid(1650+index),revisionId=uuid(1660+index)
  await q("insert into onboarding_modules(id,workspace_id,internal_code,status) values($1,$2,$3,'active')",[moduleId,w,'isolated-'+index])
  await q("insert into onboarding_module_revisions(id,workspace_id,module_id,status,definition) values($1,$2,$3,'published','{}')",[revisionId,w,moduleId])
  await q("insert into relationship_onboarding_session_modules(id,workspace_id,session_id,module_id,module_revision_id,source_kind,title,sort_order) values($1,$2,$3,$4,$5,'mandatory','Service information',500+$6)",[m,w,b.id,moduleId,revisionId,index])
  await q("insert into relationship_onboarding_session_steps(id,workspace_id,session_id,session_module_id,module_revision_id,kind,title,sort_order,is_actionable) values($1,$2,$3,$4,$5,'form','Service details',500+$6,true)",[st,w,b.id,m,revisionId,index])
  await q('insert into service_instance_module_requirements(workspace_id,instance_id,session_id,session_module_id) values($1,$2,$3,$4)',[w,instance.instance_id,b.id,m]);isolatedSteps.push(st)
 }

 const bsteps=await q('select * from relationship_onboarding_session_steps where session_id=$1 and is_actionable order by sort_order',[b.id])
 for(const step of bsteps){
  await q("insert into work_items(workspace_id,title,status,native_kind,native_key,metadata) values($1,$2,'todo','onboarding_step',$3,$4) on conflict (workspace_id,native_kind,native_key) where native_kind is not null and native_key is not null do nothing",[w,step.title,b.id+':step:'+step.id,{session_id:b.id,session_step_id:step.id}])
  await q("update work_items set status='done',actual_completed_at=now() where workspace_id=$1 and native_key=$2",[w,b.id+':step:'+step.id])
 }
 await q('select refresh_service_onboarding_readiness($1,$2)',[w,b.id])
 const reviews=await q("select id,metadata from work_items where workspace_id=$1 and native_key like $2",[w,b.id+':service-review:%']);assert(reviews.length>0)
 for(const review of reviews.filter(review=>review.metadata.session_step_id!==isolatedSteps[1]))await q("update work_items set status='done',actual_completed_at=now() where id=$1",[review.id])
 assert.equal((await one('select stage from relationship_service_instances where id=$1',[instances[0].instance_id])).stage,'setup')
 assert.equal((await one('select stage from relationship_service_instances where id=$1',[instances[1].instance_id])).stage,'onboarding')
 const count=reviews.length;await q('select refresh_service_onboarding_readiness($1,$2)',[w,b.id]);assert.equal((await q("select id from work_items where workspace_id=$1 and native_key like $2",[w,b.id+':service-review:%'])).length,count)
 for(const review of reviews)await q("update work_items set status='done',actual_completed_at=now() where id=$1",[review.id])
 assert.equal((await one('select stage from relationship_service_instances where id=$1',[instances[1].instance_id])).stage,'setup')
 assert.equal((await one('select status from relationship_onboarding_sessions where id=$1',[a.id])).status,'active')
 pass('per-service review readiness advances one service at a time without completing another session or duplicating reviews')

 // Only this run is replaced. Historical responses keep their old IDs.
 await db.exec(`

 create function require_onboarding_admin_actor(p_workspace_id uuid,p_actor_user_id uuid) returns void language plpgsql as $$ begin if not exists(select 1 from workspace_memberships where workspace_id=p_workspace_id and user_id=p_actor_user_id and role in('owner','admin')) then raise exception 'Admin required';end if;end $$;
 `)
 // The activity adapter in this fixture omits only unrelated telemetry storage.
 await db.exec('drop function record_workspace_admin_activity(uuid,text,text,text,text,text,text,uuid,text,jsonb) cascade')
 await db.exec(`create function record_workspace_admin_activity(p_workspace_id uuid,p_area text,p_event text,p_title text,p_entity_type text default null,p_entity_id text default null,p_actor_kind text default null,p_correlation_id uuid default null,p_idempotency_key text default null,p_metadata jsonb default '{}',p_actor_user_id uuid default null,p_source_href text default null) returns uuid language sql as $$ select gen_random_uuid() $$;grant all on all tables in schema public to service_role;grant usage on schema extensions to service_role;`)
 const bBefore=await one('select status,session_token from relationship_onboarding_sessions where id=$1',[b.id])
 await db.exec('set role service_role')
 const restarted=(await one('select restart_relationship_onboarding_session($1,$2,$3,$4) result',[w,relationship,a.id,owner])).result
 const replay=(await one('select restart_relationship_onboarding_session($1,$2,$3,$4) result',[w,relationship,a.id,owner])).result
 await db.exec('reset role')
 assert.equal(replay.session_id,restarted.session_id)
 assert.deepEqual(await one('select status,session_token from relationship_onboarding_sessions where id=$1',[b.id]),bBefore)
 assert.equal((await one('select service_scope from relationship_onboarding_sessions where id=$1',[restarted.session_id])).service_scope,'selected_services')
 assert.equal((await one('select count(*) n from service_instance_sessions where session_id=$1',[restarted.session_id])).n,(await one('select count(*) n from service_instance_sessions where session_id=$1',[a.id])).n)
 assert.equal((await one('select count(*) n from service_instance_module_requirements where session_id=$1',[restarted.session_id])).n,(await one('select count(*) n from service_instance_module_requirements where session_id=$1',[a.id])).n)
 pass('restart preserves another live session, clones exact instance requirements and replays the same replacement')

 // Failure after the archive and clone still rolls back every write.
 await db.exec(`create or replace function record_workspace_admin_activity(p_workspace_id uuid,p_area text,p_event text,p_title text,p_entity_type text default null,p_entity_id text default null,p_actor_kind text default null,p_correlation_id uuid default null,p_idempotency_key text default null,p_metadata jsonb default '{}',p_actor_user_id uuid default null,p_source_href text default null) returns uuid language plpgsql as $$ begin raise exception 'fixture activity failure';end $$;`)
 const beforeFailure=await one('select count(*) n from relationship_onboarding_sessions')
 await db.exec('set role service_role')
 await assert.rejects(q('select restart_relationship_onboarding_session($1,$2,$3,$4)',[w,relationship,b.id,owner]),/fixture activity failure/)
 await db.exec('reset role')
 assert.deepEqual(await one('select status,session_token from relationship_onboarding_sessions where id=$1',[b.id]),bBefore)
 assert.deepEqual(await one('select count(*) n from relationship_onboarding_sessions'),beforeFailure)
 pass('restart failure rolls back archive, token revocation, work cancellation and replacement together')

 // Reuse maps stable source field IDs into the new frozen session, never uploads or consent.
 const newSession=await one('select id,session_token from relationship_onboarding_sessions where id=$1',[restarted.session_id])
 const oldForm=(await q("select * from relationship_onboarding_session_steps where session_id=$1 and kind='form' limit 1",[a.id]))[0]
 assert(oldForm)
 const currentForm=(await q('select * from relationship_onboarding_session_steps where session_id=$1 and module_revision_id=$2 and sort_order=$3',[newSession.id,oldForm.module_revision_id,oldForm.sort_order]))[0]
 const sourceStep=uuid(1700)
 await q('update relationship_onboarding_session_steps set source_step_id=$1 where id=any($2)',[sourceStep,[oldForm.id,currentForm.id]])
 const response={}
 for(const [index,type,label] of [[0,'text','Business name'],[1,'text','I agree to terms'],[2,'file','Upload logo']]) {
  const source=uuid(1710+index),oldField=uuid(1720+index),newField=uuid(1730+index)
  for(const [field,session,step] of [[oldField,a.id,oldForm.id],[newField,newSession.id,currentForm.id]])await q('insert into relationship_onboarding_session_fields(id,workspace_id,session_id,session_step_id,source_field_id,type,label,sort_order) values($1,$2,$3,$4,$5,$6,$7,$8)',[field,w,session,step,source,type,label,index])
  response[oldField]=index===0?'Previously confirmed business':index===1?'Yes':'private-file-path'
 }
 await q("insert into assets(id,workspace_id,native_kind,metadata) values($1,$2,'onboarding_form_submission',$3)",[uuid(1740),w,{session_id:a.id,session_step_id:oldForm.id,response}])
 await q("insert into work_items(workspace_id,title,status,native_kind,native_key,metadata) values($1,'Saved form','done','onboarding_step',$2,$3) on conflict(workspace_id,native_kind,native_key) where native_kind is not null and native_key is not null do update set status='done'",[w,a.id+':step:'+oldForm.id,{session_id:a.id,session_step_id:oldForm.id}])
 const hints=await reuse(newSession)
 assert.deepEqual(hints.responses[currentForm.id],{[uuid(1730)]:'Previously confirmed business'})
 await q('update relationship_onboarding_session_steps set source_step_id=$1 where id=$2',[uuid(1790),currentForm.id])
 assert.equal((await reuse(newSession)).responses[currentForm.id],undefined)
 await q('update relationship_onboarding_session_steps set source_step_id=$1 where id=$2',[sourceStep,currentForm.id])
 pass('answer hints require matching frozen revision and source step, map new field IDs, and exclude consent and uploads')

 // A relationship-wide team role cannot open another sale's link or attachment.
 const outsiderAsset=uuid(1800)
 await q("insert into assets(id,workspace_id,native_kind,metadata) values($1,$2,'onboarding_upload',$3)",[outsiderAsset,w,{session_id:b.id,session_step_id:isolatedSteps[0]}])
 await q('insert into asset_relationships values($1,$2,$3)',[w,relationship,outsiderAsset])
 assert.equal((await one('select workspace_user_can_access_asset($1,$2,$3) allowed',[w,outsiderAsset,unrelated])).allowed,false)
 assert.equal((await one('select workspace_user_can_access_asset($1,$2,$3) allowed',[w,outsiderAsset,owner])).allowed,true)
 assert.equal((await one('select workspace_user_can_access_full_onboarding_session($1,$2,$3) allowed',[w,b.id,unrelated])).allowed,false)
 assert.equal((await one('select workspace_user_can_access_full_onboarding_session($1,$2,$3) allowed',[w,b.id,owner])).allowed,true)
 const panel=(await one('select read_onboarding_panel_sessions($1,$2) result',[w,owner])).result
 assert(panel.sessions.some(session=>session.id===a.id&&session.status==='archived'))
 assert(panel.sessions.some(session=>session.id===b.id))
 assert.equal((await one('select read_onboarding_panel_sessions($1,$2) result',[w,unrelated])).result.sessions.length,0)
 await q('update relationship_onboarding_sessions set token_revoked_at=now() where id=$1',[newSession.id])
 await assert.rejects(reuse(newSession),/Invalid onboarding session/)
 await assert.rejects(q('select skip_previously_completed_welcome($1,$2,$3,$4)',[w,newSession.id,newSession.session_token,welcomeSteps[0].step]),/cannot be skipped/)
 pass('session history stays visible to authorized staff; unrelated team members and revoked tokens cannot read it')

 // Growing history is paged after access filtering, with stable ordering.
 await q("insert into relationship_onboarding_sessions(id,workspace_id,relationship_id,status,session_token,is_test,created_at) select gen_random_uuid(),$1,$2,'archived',gen_random_uuid()::text,true,now()-make_interval(days=>n) from generate_series(1,65) n",[w,relationship])
 const page0=(await one('select read_onboarding_panel_sessions($1,$2,0,$3) result',[w,owner,relationship])).result
 const page1=(await one('select read_onboarding_panel_sessions($1,$2,50,$3) result',[w,owner,relationship])).result
 assert.equal(page0.sessions.length,50);assert.equal(page0.hasMore,true);assert(page1.sessions.length>0);assert.equal(page1.hasMore,false)
 assert.equal(new Set([...page0.sessions,...page1.sessions].map(s=>s.id)).size,page0.sessions.length+page1.sessions.length)
 pass('onboarding history pages authorized records without overlap and retains archived runs')
 const samples=[]
 for(let n=0;n<7;n++){const start=performance.now();await one('select read_onboarding_panel_sessions($1,$2,0,$3) result',[w,owner,relationship]);samples.push(performance.now()-start)}
 samples.sort((a,b)=>a-b)
 pass(`bounded 50-session panel read: ${samples[3].toFixed(2)} ms median in isolated PGlite (7 samples; not production latency)`)

}
