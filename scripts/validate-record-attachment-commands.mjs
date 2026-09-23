// Disposable in-memory PostgreSQL fixture; never reads application credentials.
// PGLITE_PACKAGE_ROOT=/path/to/node_modules/@electric-sql/pglite node scripts/validate-record-attachment-commands.mjs
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
const { PGlite } = await import(process.env.PGLITE_PACKAGE_ROOT ? pathToFileURL(`${process.env.PGLITE_PACKAGE_ROOT}/dist/index.js`).href : '@electric-sql/pglite')
const db = new PGlite()
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const W=id(1), OTHER=id(2), ACTOR=id(3), STAFF=id(4), NOTE=id(5), NOTE2=id(6), REL=id(7), REL2=id(8), FOREIGN_REL=id(9), ASSET=id(10), FOREIGN_ASSET=id(11), WORK=id(12), PRIVATE_WORK=id(13)
let passed=0
function pass(name) { passed++; console.log(`ok ${passed} - ${name}`) }
const rpc = (name, args) => db.query(`select public.${name}(${args.map((_, i) => `$${i+1}`).join(',')}) as result`, args).then(r => r.rows[0].result)
async function rejects(name, fn, code) { await assert.rejects(fn, e => e.code===code); pass(name) }
try {
    await db.exec(`create schema auth; create role anon; create role authenticated; create role service_role bypassrls;
    create table auth.users(id uuid primary key);
    create table workspaces(id uuid primary key,status text not null default 'active');
    create table workspace_memberships(workspace_id uuid,user_id uuid,role text);
    create table relationships(id uuid primary key,workspace_id uuid references workspaces(id),status text not null default 'active');
    create table work_items(id uuid primary key,workspace_id uuid references workspaces(id),visibility text not null default 'workspace');
    create table assets(id uuid primary key,workspace_id uuid references workspaces(id),title text,description text,asset_kind text,source_kind text,storage_path text,content_type text,file_size bigint,native_kind text,metadata jsonb not null default '{}',created_by uuid,updated_at timestamptz not null default now());
    create table asset_relationships(workspace_id uuid references workspaces(id),asset_id uuid references assets(id),relationship_id uuid references relationships(id),created_at timestamptz default now(),primary key(asset_id,relationship_id));
    create table asset_work_items(workspace_id uuid references workspaces(id),asset_id uuid references assets(id),work_item_id uuid references work_items(id),created_at timestamptz default now(),primary key(asset_id,work_item_id));
    create function set_updated_at() returns trigger language plpgsql as $$ begin new.updated_at:=clock_timestamp(); return new; end $$;
    create function is_workspace_member(uuid,text[]) returns boolean language sql as $$select false$$;
    `)
    await db.exec(await readFile('supabase/migrations/20260918130000_workspace_notes.sql','utf8'))
    await db.exec(await readFile('supabase/migrations/20260919091000_note_attachment_links.sql','utf8'))
    const privacy = await readFile('supabase/migrations/20260804110000_admin_okr_maintenance.sql','utf8')
    await db.exec(privacy.match(/create or replace function public\.validate_private_work_item_links\(\)[\s\S]*?\$\$;/)[0])
    await db.exec('create trigger validate_private_asset_work_item before insert or update on asset_work_items for each row execute function validate_private_work_item_links();')
    await db.exec(await readFile('supabase/migrations/20260923170000_note_attachment_integrity.sql','utf8'))
    await db.exec(await readFile('supabase/migrations/20260923171000_record_attachment_commands.sql','utf8'))
    await db.query('insert into workspaces(id) values ($1),($2)',[W,OTHER])
    await db.query('insert into auth.users(id) values($1),($2)',[ACTOR,STAFF])
    await db.query("insert into workspace_memberships values($1,$2,'admin'),($1,$3,'staff')",[W,ACTOR,STAFF])
    await db.query("insert into notes(id,workspace_id,name,description) values($1,$2,'Original','Original description'),($3,$2,'Other','Other description')",[NOTE,W,NOTE2])
    await db.query('insert into relationships(id,workspace_id) values($1,$2),($3,$2),($4,$5)',[REL,W,REL2,FOREIGN_REL,OTHER])
    await db.query("insert into assets(id,workspace_id,title) values($1,$2,'Fixture'),($3,$4,'Foreign')",[ASSET,W,FOREIGN_ASSET,OTHER])
    await db.query("insert into work_items(id,workspace_id,visibility) values($1,$2,'workspace'),($3,$2,'admins_only')",[WORK,W,PRIVATE_WORK])
    await db.exec('grant usage on schema public to service_role,authenticated; grant all on all tables in schema public to service_role; set role service_role;')
    for (const [owner,ownerId,kind,target] of [['relationship',REL,'asset',ASSET],['relationship',REL,'note',NOTE],['work-item',WORK,'asset',ASSET],['work-item',WORK,'note',NOTE],['note',NOTE,'asset',ASSET],['note',NOTE,'note',NOTE2]]) {
        await rpc('attach_existing_record',[W,ACTOR,owner,ownerId,kind,target]); await rpc('attach_existing_record',[W,ACTOR,owner,ownerId,kind,target]); pass(`${owner} to ${kind} links and duplicate retry`)
    }
    await rejects('cross-workspace asset denied',()=>rpc('attach_existing_record',[W,ACTOR,'note',NOTE,'asset',FOREIGN_ASSET]),'P0001')
    await rejects('self-note denied',()=>rpc('attach_existing_record',[W,ACTOR,'note',NOTE,'note',NOTE]),'P0001')
    await rejects('staff denied',()=>rpc('attach_existing_record',[W,STAFF,'note',NOTE,'asset',ASSET]),'P0001')
    await rejects('private-work-item asset trigger retained',()=>rpc('attach_existing_record',[W,ACTOR,'work-item',PRIVATE_WORK,'asset',ASSET]),'P0001')
    await db.exec('reset role; set role authenticated;')
    await rejects('untrusted role cannot execute command',()=>rpc('save_note_text',[W,ACTOR,NOTE,'name','bad','Original']),'42501')
    await db.exec('reset role; set role service_role;')
    assert.equal((await rpc('save_note_text',[W,ACTOR,NOTE,'name','New name','Original'])).ok,true)
    assert.equal((await rpc('save_note_text',[W,ACTOR,NOTE,'description','New description','Original description'])).ok,true)
    pass('different fields preserve concurrent changes')
    const conflict=await rpc('save_note_text',[W,ACTOR,NOTE,'name','Stale name','Original'])
    assert.equal(conflict.ok,false);assert.equal(conflict.value,'New name');pass('stale same-field update returns conflict and saved value')
    const replay=await rpc('save_note_text',[W,ACTOR,NOTE,'name','New name','Original']);assert.equal(replay.ok,true);pass('lost acknowledgement text replay succeeds without overwriting')
    await rpc('edit_note_relationships',[W,ACTOR,NOTE,[REL2],[]])
    await rpc('edit_note_relationships',[W,ACTOR,NOTE,[],[REL]])
    assert.deepEqual(await rpc('edit_note_relationships',[W,ACTOR,NOTE,[],[]]),[REL2]);pass('stale explicit removals preserve unseen concurrent additions')
    await rejects('mixed foreign addition rolls back removals',()=>rpc('edit_note_relationships',[W,ACTOR,NOTE,[FOREIGN_REL],[REL2]]),'P0001')
    assert.deepEqual(await rpc('edit_note_relationships',[W,ACTOR,NOTE,[],[]]),[REL2]);pass('failed link transaction leaves existing links intact')
    const payload={title:'Created note',description:'Created description',relationship_ids:[REL],asset_ids:[ASSET],work_item_id:WORK,note_id:NOTE}
    const request=id(20)
    assert.equal((await rpc('create_attachment_record',[W,ACTOR,request,'note',payload])).record_id,request)
    assert.equal((await rpc('create_attachment_record',[W,ACTOR,request,'note',payload])).record_id,request)
    assert.equal((await db.query('select count(*)::int as n from notes where id=$1',[request])).rows[0].n,1);pass('atomic note create/retry creates one record')
    assert.equal((await db.query('select count(*)::int as n from note_relationships where note_id=$1',[request])).rows[0].n,1);pass('atomic note create retains requested links')
    await rejects('changed replay rejected',()=>rpc('create_attachment_record',[W,ACTOR,request,'note',{...payload,title:'different'}]),'P0001')
    assert.equal((await rpc('create_attachment_record',[W,ACTOR,id(21),'note',{...payload,relationship_ids:[FOREIGN_REL]}])).status,'rejected');pass('bad target durably rejects the request')
    assert.equal((await db.query('select count(*)::int as n from notes where id=$1',[id(21)])).rows[0].n,0);pass('failed note command leaves record count unchanged')
    const assetRequest=id(22),assetPayload={title:'Created asset',description:'',relationship_ids:[REL],asset_ids:[],work_item_id:WORK,note_id:NOTE,storage_path:`${W}/assets/${ACTOR}/${assetRequest}/original`,file_size:100,content_type:'application/pdf',asset_kind:'document',original_name:'fixture.pdf'}
    assert.equal((await rpc('create_attachment_record',[W,ACTOR,assetRequest,'asset',assetPayload])).record_id,assetRequest)
    assert.equal((await rpc('create_attachment_record',[W,ACTOR,assetRequest,'asset',assetPayload])).record_id,assetRequest);pass('atomic asset create/retry creates one record')
    const badRequest=id(23)
    const rejectedPayload={...assetPayload,storage_path:`${W}/assets/${ACTOR}/${badRequest}/original`,work_item_id:PRIVATE_WORK};assert.equal((await rpc('create_attachment_record',[W,ACTOR,badRequest,'asset',rejectedPayload])).status,'rejected');pass('link trigger failure durably rejects and rolls back created asset and all links')
    assert.equal((await db.query('select count(*)::int as n from assets where id=$1',[badRequest])).rows[0].n,0)
    assert.equal((await db.query('select count(*)::int as n from asset_relationships where asset_id=$1',[badRequest])).rows[0].n,0)
    assert.equal((await db.query("select count(*)::int as n from record_attachment_commands where request_id=$1 and status='rejected'",[badRequest])).rows[0].n,1);pass('failed create leaves only the terminal rejection receipt')
    await db.query("update work_items set visibility='workspace' where id=$1",[PRIVATE_WORK]);assert.equal((await rpc('create_attachment_record',[W,ACTOR,badRequest,'asset',rejectedPayload])).status,'rejected');pass('delayed retry cannot commit a rejected request even after its target becomes valid')
    assert.equal((await rpc('create_attachment_record',[W,ACTOR,id(24),'asset',{...assetPayload,storage_path:'foreign/key'}])).status,'rejected');pass('foreign storage key refused inside SQL too')
    const nullSize=id(26);assert.equal((await rpc('create_attachment_record',[W,ACTOR,nullSize,'asset',{...assetPayload,storage_path:`${W}/assets/${ACTOR}/${nullSize}/original`,file_size:null}])).status,'rejected');pass('null upload size refused')
    await db.query("update relationships set status='archived' where id=$1",[REL]);assert.equal((await rpc('create_attachment_record',[W,ACTOR,request,'note',payload])).record_id,request);pass('accepted replay survives later target archival')
    const expired=id(27),expiredPayload={...assetPayload,storage_path:`${W}/assets/${ACTOR}/${expired}/original`};assert.equal((await rpc('create_attachment_record',[W,ACTOR,expired,'asset',expiredPayload,'upload_expired'])).status,'rejected');assert.equal((await rpc('create_attachment_record',[W,ACTOR,expired,'asset',expiredPayload])).status,'rejected');pass('expired upload records a terminal rejection that later calls cannot commit')
    await db.query("update relationships set status='active' where id=$1",[REL])
    const race=id(25);const replies=await Promise.all([rpc('create_attachment_record',[W,ACTOR,race,'note',payload]),rpc('create_attachment_record',[W,ACTOR,race,'note',payload])]);assert.deepEqual(replies.map(reply=>reply.record_id),[race,race]);pass('concurrent duplicate commands converge')
    console.log(JSON.stringify({passed,productionCalls:0,environment:'PGlite in memory; serialized connection, not a multi-connection lock-contention benchmark'}))
} finally {await db.close()}
