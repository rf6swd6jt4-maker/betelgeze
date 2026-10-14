import {readFile} from 'node:fs/promises'
export const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const read=p=>readFile(new URL('../../'+p,import.meta.url),'utf8')
export const migration=()=>read('supabase/migrations/20261014120000_shared_service_queue.sql')
const fn=(s,name)=>{const start=s.search(new RegExp('create (?:or replace )?function public\\.'+name+'\\('));if(start<0)throw Error(name);const end=s.indexOf('$$;',s.indexOf('as $$',start));return s.slice(start,end+3)}
export async function fixtureSql(){
 const base=await read('scripts/validate-personal-queue-sql.mjs')
 let schema=base.split('await db.exec(`')[1].split('`)')[0].replace(/create function workspace_user_can_access_(?:relationship|work_item)[^\n]+\n/g,'')
 schema+=`
 create schema auth; create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('fixture.actor',true),'')::uuid$$;
 create function auth.role() returns text language sql stable as $$select 'service_role'::text$$;
 create function current_session_is_aal2() returns boolean language sql stable as $$select coalesce(current_setting('fixture.aal',true),'aal2')='aal2'$$;
 alter table workspaces add column slug text default 'fixture';
 alter table relationships add column seller_user_id uuid,add column fulfilment_manager_user_id uuid,add column pos_started_at timestamptz default now(),add column team_locked_at timestamptz default now(),add column lifecycle_phase text default 'fulfilment',add unique(workspace_id,id);
 alter table relationship_service_instances add column import_id uuid,add column seller_user_id uuid,add column manager_user_id uuid,add column origin text default 'already_onboarded',add column version integer default 1,add column created_at timestamptz default now(),add unique(workspace_id,id);
 alter table relationship_services add column service_key text default 'ads',add column service_revision_id uuid,add column upfront_price_cents integer,add column recurring_price_cents integer,add column currency text,add column created_at timestamptz default now();
 alter table onboarding_service_revisions add column service_id uuid,add column default_upfront_price_cents integer default 0,add column default_recurring_price_cents integer default 0,add column currency text default 'USD';
 alter table work_items add column native_key text;
 create table user_profiles(user_id uuid primary key,display_name text,username text);
 create table workspace_member_service_access(workspace_id uuid,user_id uuid,service_id uuid,primary key(workspace_id,user_id,service_id));
 create table workspace_teams(id uuid primary key default gen_random_uuid(),workspace_id uuid,name text,kind text,relationship_id uuid,archived_at timestamptz,unique(workspace_id,relationship_id));
 create table workspace_team_members(workspace_id uuid,team_id uuid,user_id uuid,added_by uuid,primary key(team_id,user_id));
 create table workspace_native_conversations(id uuid primary key default gen_random_uuid(),workspace_id uuid,team_id uuid,kind text,archived_at timestamptz,created_by uuid,unique(team_id,kind));
 create table workspace_native_conversation_participants(conversation_id uuid,user_id uuid);
 create table workspace_native_messages(id uuid primary key default gen_random_uuid(),workspace_id uuid,conversation_id uuid,sender_user_id uuid,client_request_id uuid unique,body text,created_at timestamptz default now());
 create function workspace_role_for_user(uuid,uuid) returns text language sql stable as $$select role from workspace_memberships where workspace_id=$1 and user_id=$2$$;
 create table assets(id uuid primary key,workspace_id uuid,metadata jsonb default '{}');
 create table asset_relationships(workspace_id uuid,asset_id uuid,relationship_id uuid);
 create table asset_work_items(workspace_id uuid,asset_id uuid,work_item_id uuid);
 create table client_sales(id uuid primary key,workspace_id uuid,seller_user_id uuid,service_manager_user_id uuid);
 create table client_sale_items(id uuid primary key,workspace_id uuid,client_sale_id uuid,service_instance_id uuid,service_name text,sort_order integer);
 create table relationship_onboarding_sessions(id uuid primary key,workspace_id uuid,relationship_id uuid,source_sale_id uuid,original_source_sale_id uuid,service_scope text);
 create table relationship_onboarding_session_modules(id uuid primary key,workspace_id uuid,session_id uuid,source_service_revision_id uuid,source_kind text);
 create table relationship_onboarding_session_steps(id uuid primary key,workspace_id uuid,session_id uuid,session_module_id uuid);
 create table service_instance_module_requirements(workspace_id uuid,instance_id uuid,session_id uuid,session_module_id uuid,review_required boolean);
 create function workspace_user_can_sell(uuid,uuid) returns boolean language sql as $$select false$$;
 create function workspace_user_can_access_session_step(uuid,uuid,uuid) returns boolean language sql as $$select false$$;
 create function create_relationship_delivery_team(p_workspace_id uuid,p_relationship_id uuid) returns uuid language plpgsql as $$declare t uuid;begin select id into t from workspace_teams where workspace_id=p_workspace_id and relationship_id=p_relationship_id; if t is null then insert into workspace_teams(workspace_id,relationship_id,kind,name) values(p_workspace_id,p_relationship_id,'relationship','Internal client group') returning id into t;end if;return t;end$$;
 create index fixture_work_relationship on work_item_relationships(workspace_id,work_item_id,relationship_id);
 create index fixture_instance_links on service_instance_work_items(workspace_id,instance_id,work_item_id);
 create index fixture_instance_assignee on relationship_service_instances(workspace_id,assignee_user_id);
 `
 const service=await read('supabase/migrations/20260912130000_relationship_services_ui.sql')
 for(const name of ['workspace_user_can_access_relationship','workspace_user_fully_covers_relationship','relationship_service_rows','can_read_service_instance']) schema+=fn(service,name)+'\n'
 const review=await read('supabase/migrations/20260927120000_onboarding_review_queue_access.sql')
 schema+=fn(review,'workspace_user_can_access_work_item')
 const onboarding=await read('supabase/migrations/20260913150000_onboarding_session_readiness.sql')
 for(const name of ['workspace_user_can_access_session_module','read_selected_service_session_access','workspace_user_can_access_full_onboarding_session','workspace_user_can_access_asset'])schema+=fn(onboarding,name)
 schema+=await read('supabase/migrations/20260711194500_work_item_actual_time_presence.sql')
 schema+='create trigger status_transition before update on work_items for each row execute function apply_work_item_status_transition();'
 schema+=await read('supabase/migrations/20260915120000_personal_work_queue.sql')
 let feedback=await read('supabase/migrations/20260915150000_work_queue_feedback.sql')
 const a=feedback.indexOf('create or replace function public.dispatch_pending_work_queue'),b=feedback.indexOf('do $$declare f record;',a)
 schema+=feedback.slice(0,a)+feedback.slice(b)
 schema+=fn(await read('supabase/migrations/20260920150000_service_work_and_fulfilment_chat.sql'),'ensure_active_service_fulfilment_chat')
 const chat=await read('supabase/migrations/20260815143000_workspace_teams_native_chat.sql')
 schema+=fn(chat,'native_conversation_can_read')+fn(chat,'native_conversation_can_write')
 return schema
}
export async function seed(db){
 const q=(s,p=[])=>db.query(s,p)
 const w=id(1),alice=id(2),bob=id(3),admin=id(4),outsider=id(5),client=id(10),instance=id(11),service=id(12)
 await q('insert into workspaces(id) values($1)',[w])
 for(const [user,role,name] of [[alice,'staff','Alice'],[bob,'staff','Bob'],[admin,'admin','Admin'],[outsider,'staff','Outsider']]){
  await q('insert into auth.users values($1)',[user]);await q('insert into workspace_memberships values($1,$2,$3)',[w,user,role]);await q('insert into user_profiles values($1,$2,$2)',[user,name]);await q('insert into workspace_member_service_access values($1,$2,$3)',[w,user,service])
 }
 await q("insert into relationships(id,workspace_id,primary_person_name,fulfilment_manager_user_id) values($1,$2,'Synthetic client',$3)",[client,w,admin])
 await q("insert into relationship_service_instances(id,workspace_id,relationship_id,service_id,service_key,assignee_user_id) values($1,$2,$3,$4,'ads',$5)",[instance,w,client,service,alice])
 for(let n=20;n<27;n++){
  await q("insert into work_items(id,workspace_id,service_id,title,instructions,execution_owner_id) values($1,$2,$3,$4,'Original instructions',$5)",[id(n),w,service,'Shared task '+n,alice]);await q('insert into work_item_relationships values($1,$2,$3)',[w,id(n),client]);await q('insert into service_instance_work_items values($1,$2,$3)',[w,id(n),instance])
 }
 return {w,alice,bob,admin,outsider,client,instance,service}
}
