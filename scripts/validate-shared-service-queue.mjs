import assert from 'node:assert/strict'
import {PGlite} from './pglite-fixture.mjs'
import {fixtureSql,migration,seed,id} from './shared-service-queue/fixture.mjs'
const db=new PGlite()
try {
 await db.exec(await fixtureSql());await db.exec(await migration());const {w,alice,bob,admin,outsider,client,instance,service}=await seed(db)
 const q=async(s,p=[])=>(await db.query(s,p)).rows,one=async(s,p=[])=>(await q(s,p))[0]
 const roster=async(actor=admin)=>(await one('select read_service_queue_roster($1,$2,$3,$4) r',[w,client,instance,actor])).r
 let serial=100
 const save=async(members,actor=admin,version,request=id(serial++))=>(await one('select save_service_queue_roster($1,$2,$3,$4,$5,$6,$7) r',[w,client,instance,actor,request,version??(await roster()).version,members])).r
 const queue=async(user)=>(await one('select read_personal_work_queue($1,$2) r',[w,user])).r
 const version=async(n)=>(await one('select updated_at from work_items where id=$1',[id(n)])).updated_at
 const command=async(n,action,user,ver,request=id(serial++))=>(await one('select shared_queue_command($1,$2,$3,$4,$5,$6) r',[w,user,id(n),action,ver??await version(n),request])).r
 // Exercise legacy command ownership against the canonical predicate, including
 // NULL ownership, explicit assignment precedence and private administrative work.
 for(const owner of [alice,bob,null])for(const actor of [alice,bob,admin,outsider]){
  await db.exec('begin')
  await q('update work_items set execution_owner_id=$2 where id=$1',[id(20),owner])
  if(owner===null)await q('insert into work_item_assignees values($1,$2,$3)',[w,id(20),bob])
  const allowed=(await one('select personal_queue_owns($1,$2,$3) ok',[w,id(20),actor])).ok
  const action=q('select personal_queue_command($1,$2,$3,$4,$5)',[w,actor,id(20),'start',await version(20)])
  if(allowed)await action;else await assert.rejects(action,/not available/)
  await db.exec('rollback')
 }
 await q('select ensure_active_service_fulfilment_chat($1,$2)',[w,client])
 const originalChat=(await one('select id from workspace_native_conversations')).id
 await q('insert into workspace_native_messages(workspace_id,conversation_id,sender_user_id,body) values($1,$2,$3,$4)',[w,originalChat,alice,'Retained synthetic history'])
 const before=await q('select * from work_items order by id')
 await assert.rejects(save([bob],alice,0),/Owner or admin/)
 await assert.rejects(save([id(999)]),/eligible/)
 await assert.rejects(save([bob,bob]),/Duplicate/)
 await save([bob]);assert.deepEqual(await q('select * from work_items order by id'),before)
 assert.deepEqual((await queue(alice)).items.map(x=>x.id),(await queue(bob)).items.map(x=>x.id));assert.equal((await queue(outsider)).total,0)
 // Different personal calendars must not reorder the shared service.
 await q("insert into work_queue_plans(workspace_id,user_id,work_item_id,effort_minutes,horizon,anchor_day,target_day,reason) values($1,$2,$3,1,'now',current_date,current_date,'Personal only'),($1,$4,$3,400,'week',current_date,current_date+5,'Different calendar')",[w,alice,id(20),bob])
 await db.exec('begin');assert.deepEqual((await queue(alice)).items,(await queue(bob)).items);await db.exec('rollback')
 await q("select set_config('fixture.actor',$1,false)",[bob]);await db.exec("set fixture.aal='aal1'")
 assert.equal((await one('select can_read_service_instance($1,$2) ok',[w,instance])).ok,false)
 await db.exec("set fixture.aal='aal2'");assert.equal((await one('select can_read_service_instance($1,$2) ok',[w,instance])).ok,true)
 const c=(await one('select id from workspace_native_conversations')).id
 assert.equal(c,originalChat);assert.equal((await one('select count(*)::int n from workspace_native_conversations')).n,1);assert.equal((await one('select body from workspace_native_messages')).body,'Retained synthetic history')
 assert.equal((await one('select native_conversation_can_read($1,$2) ok',[c,bob])).ok,true)
 assert.equal((await one('select native_conversation_can_write($1,$2) ok',[c,bob])).ok,true)
 assert.equal((await one('select native_conversation_can_write($1,$2) ok',[c,outsider])).ok,false)
 console.log('PASS roster authorization, scope, shared existing work, common queue and existing group')
 const v=await version(20),request=id(serial++)
 const started=await command(20,'start',alice,v,request);assert.deepEqual(await command(20,'start',alice,v,request),started)
 await assert.rejects(command(20,'start',bob,v),/changed/)
 await command(21,'start',bob);await assert.rejects(command(22,'start',bob),/Pause your current/)
 await command(20,'complete',bob);assert.equal((await one('select completed_by from service_queue_activity where work_item_id=$1',[id(20)])).completed_by,bob)
 await assert.rejects(command(20,'complete',alice),/no longer available/)
 assert.equal((await one('select count(*)::int n from work_queue_completion_followups where work_item_id=$1',[id(20)])).n,1)
 console.log('PASS stale start, same-request replay, independent actors, active limit, cross-member completion and one follow-up')
 await q('insert into work_item_dependencies values($1,$2,$3)',[w,id(22),id(23)])
 await assert.rejects(command(22,'start',alice),/prerequisites/)
 await q("update work_items set visibility='admins_only' where id=$1",[id(26)]);assert.equal((await queue(bob)).items.some(x=>x.id===id(26)),false)
 await q('insert into relationships(id,workspace_id) values($1,$2)',[id(30),w]);await q('insert into work_item_relationships values($1,$2,$3)',[w,id(25),id(30)])
 assert.equal((await queue(bob)).items.some(x=>x.id===id(25)),false)
 await assert.rejects(command(23,'start',outsider),/not available/)
 console.log('PASS prerequisite, private work, other-client links and unassigned staff denial')
 const oldRoster=await roster();await save([]);await assert.rejects(save([bob],admin,oldRoster.version),/changed/)
 assert.equal((await queue(bob)).total,0);assert.equal((await one('select native_conversation_can_read($1,$2) ok',[c,bob])).ok,false)
 assert.equal((await one('select status from work_items where id=$1',[id(21)])).status,'todo')
 await assert.rejects(command(23,'start',bob),/not available/)
 await q('insert into workspace_team_members(workspace_id,team_id,user_id) select $1,team_id,$2 from workspace_native_conversations where id=$3',[w,bob,c])
 await save([bob]);await save([]);assert.equal((await one('select native_conversation_can_read($1,$2) ok',[c,bob])).ok,true)
 console.log('PASS removal, active-worker release, stale roster and independent chat grant preservation')

 await save([bob])
 await assert.rejects(q('delete from workspace_member_service_access where workspace_id=$1 and user_id=$2 and service_id=$3',[w,bob,service]),/Remove this person/)
 await assert.rejects(q('delete from workspace_memberships where workspace_id=$1 and user_id=$2',[w,bob]),/Remove this person/)
 await q("update relationship_service_instances set disposition='paused' where id=$1",[instance])
 assert.equal((await one('select native_conversation_can_read($1,$2) ok',[c,bob])).ok,true)
 await assert.rejects(command(23,'start',bob),/not active/)
 await q("update relationship_service_instances set disposition='active' where id=$1",[instance])
 // Exact session/module access, full-session token denial, linked assets and wrong-client review.
 await q("insert into relationship_onboarding_sessions(id,workspace_id,relationship_id,service_scope) values($1,$2,$3,'selected_services')",[id(40),w,client])
 for(const n of [41,42])await q('insert into relationship_onboarding_session_modules(id,workspace_id,session_id) values($1,$2,$3)',[id(n),w,id(40)])
 await q('insert into relationship_onboarding_session_steps values($1,$2,$3,$4)',[id(43),w,id(40),id(41)])
 await q('insert into service_instance_module_requirements values($1,$2,$3,$4,true)',[w,instance,id(40),id(41)])
 assert.equal((await one('select workspace_user_can_access_session_module($1,$2,$3) ok',[w,id(41),bob])).ok,true)
 assert.equal((await one('select workspace_user_can_access_session_module($1,$2,$3) ok',[w,id(42),bob])).ok,false)
 assert.equal((await one('select workspace_user_can_access_full_onboarding_session($1,$2,$3) ok',[w,id(40),bob])).ok,false)
 const access=(await one('select read_selected_service_session_access($1,$2,$3) r',[w,[id(40)],bob])).r
 assert.deepEqual(access.moduleIds,[id(41)]);assert.deepEqual(access.fullSessionIds,[])
 await q('insert into assets values($1,$2,$3)',[id(44),w,{session_id:id(40),session_step_id:id(43)}])
 assert.equal((await one('select workspace_user_can_access_asset($1,$2,$3) ok',[w,id(44),bob])).ok,true)
 await q('insert into assets(id,workspace_id) values($1,$2)',[id(45),w]);await q('insert into asset_work_items values($1,$2,$3)',[w,id(45),id(23)])
 assert.equal((await one('select workspace_user_can_access_asset($1,$2,$3) ok',[w,id(45),bob])).ok,true)
 assert.equal((await one('select workspace_user_can_access_asset($1,$2,$3) ok',[w,id(45),outsider])).ok,false)
 await q("update work_items set service_id=null,native_kind='relationship_workflow',workflow_role='review',native_key=$2,metadata=$3 where id=$1",[id(24),id(40)+':service-review:'+id(43),{session_id:id(40),session_step_id:id(43)}])
 assert.equal((await one('select service_queue_can_work($1,$2,$3) ok',[w,id(24),bob])).ok,true)
 await q('update relationship_onboarding_sessions set relationship_id=$2 where id=$1',[id(40),id(30)])
 assert.equal((await one('select service_queue_can_work($1,$2,$3) ok',[w,id(24),bob])).ok,false)
 assert.equal((await one('select workspace_user_can_access_session_module($1,$2,$3) ok',[w,id(41),bob])).ok,false)
 console.log('PASS offboarding guards, paused chat, exact review/module/asset scope and full-session denial')
 // Compare bulk retrieval against the independently evaluated canonical predicate.
 for(const user of [alice,bob,admin,outsider]){
  const expected=await q('select id from work_items w where w.workspace_id=$1 and queue_work_open(w) and personal_queue_owns($1,w.id,$2) order by id',[w,user])
  const actual=await q('select w.id from service_queue_visible_work($1,$2) s join work_items w on w.id=s.work_item_id where queue_work_open(w) order by w.id',[w,user])
  assert.deepEqual(actual,expected)
 }
 const oldV=(await roster()).version
 await q('update relationship_service_instances set assignee_user_id=$2 where id=$1',[instance,bob])
 assert.equal((await roster()).version,oldV+1);assert.deepEqual((await roster()).memberIds,[])
 await assert.rejects(save([outsider],admin,oldV),/changed/)
 await command(23,'start',bob)
 const doneVersion=await version(23),doneRequest=id(serial++),done=await command(23,'complete',bob,doneVersion,doneRequest)
 await q("update relationship_service_instances set stage='completed' where id=$1",[instance])
 assert.deepEqual(await command(23,'complete',bob,doneVersion,doneRequest),done)
 // A feature-created extra who becomes primary gains retained historical chat access.
 await q("update relationship_service_instances set stage='setup' where id=$1",[instance])
 await save([outsider]);assert.equal((await one('select count(*)::int n from service_queue_chat_members where user_id=$1',[outsider])).n,1)
 await q('update relationship_service_instances set assignee_user_id=$2 where id=$1',[instance,outsider])
 assert.equal((await one('select count(*)::int n from service_queue_chat_members where user_id=$1',[outsider])).n,0)
 await q('update relationship_service_instances set assignee_user_id=$2 where id=$1',[instance,alice])
 assert.equal((await one('select native_conversation_can_read($1,$2) ok',[c,outsider])).ok,true)

 // Existing dispute/admin paths may pause work without a queue command.
 // Reconcile the actor's stale claim at their next shared start.
 await q("update work_items set status='todo' where id=$1",[id(23)]);await command(23,'start',alice)
 await q("update work_items set status='todo' where id=$1",[id(23)])
 await q("update work_items set visibility='workspace' where id=$1",[id(26)])
 await command(26,'start',alice)
 assert.equal((await one('select count(*)::int n from service_queue_activity where started_by=$1 and active',[alice])).n,1)
 console.log('PASS bulk/canonical scope parity, transfer version fence and replay after service completion')
 await db.exec('set role authenticated');await assert.rejects(roster(),/permission denied/);await assert.rejects(q('select * from service_queue_members'),/permission denied/);await db.exec('reset role')
 await assert.rejects(q("update service_queue_receipts set input='{}'"),/immutable/)
 console.log('PASS ordinary-role denial and immutable action receipts')
} catch(error) { console.error(error.message, error.code, error.where); process.exitCode=1 } finally {await db.close()}
