// Explicit optional rehearsal. Creates and stops its own temporary PostgreSQL cluster.
// BE_RECORDS_PG_BIN=/absolute/path/to/bin node scripts/validate-records-postgres-concurrency.mjs
// Never accepts a database URL, reads app credentials, or connects to an existing cluster.
import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const bin = process.env.BE_RECORDS_PG_BIN
assert.ok(bin && path.isAbsolute(bin), 'Set BE_RECORDS_PG_BIN to a reviewed PostgreSQL binary directory')
const evidencePath = process.env.BE_RECORDS_PG_EVIDENCE
const env = { PATH: '/usr/bin:/bin', LC_ALL: 'C', TZ: 'UTC' }
const temporary = await mkdtemp(path.join(tmpdir(), 'be-records-pg-'))
const data = path.join(temporary, 'data'), socket = path.join(temporary, 'socket')
await mkdir(socket, { mode: 0o700 })
const port = '55479' // UNIX socket only; no TCP listener is enabled.
const sessions = new Set()
const results = [], observations = [], sources = {}
let startAttempted = false, serverStarted = false, outcome = 'failed'
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const W=id(1), OTHER=id(2), ACTOR=id(3), STAFF=id(4), NOTE=id(5), NOTE2=id(6), REL=id(7), REL2=id(8), FOREIGN_REL=id(9), ASSET=id(10), FOREIGN_ASSET=id(11), WORK=id(12), PRIVATE_WORK=id(13)
const literal = value => value == null ? 'null' : `'${String(value).replaceAll("'", "''")}'`
const argument = value => Array.isArray(value) ? `array[${value.map(literal)}]::uuid[]` : typeof value === 'object' && value !== null ? `${literal(JSON.stringify(value))}::jsonb` : literal(value)
const sqlCall = (name,args) => `select to_jsonb(public.${name}(${args.map(argument).join(',')}))`
const notePayload = extra => ({title:'Synthetic note',description:'Synthetic description',relationship_ids:[REL],asset_ids:[ASSET],work_item_id:WORK,note_id:NOTE,...extra})
const assetPayload = (request,extra) => ({title:'Synthetic asset',description:'',relationship_ids:[REL],asset_ids:[],work_item_id:WORK,note_id:NOTE,storage_path:`${W}/assets/${ACTOR}/${request}/original`,file_size:100,content_type:'text/plain',asset_kind:'file',original_name:'fixture.txt',...extra})
function pass(name, extra={}) { results.push({name,passed:true,...extra}); console.log(`ok ${results.length} - ${name}`) }
async function source(relative) {
    const value=await readFile(path.join(root,relative),'utf8')
    sources[relative]=createHash('sha256').update(value).digest('hex')
    return value
}
class Session {
    constructor(name) {
        this.name=name;this.buffer='';this.errors='';this.pending=null;this.serial=0
        this.child=spawn(path.join(bin,'psql'),['-X','--no-password','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose','-h',socket,'-p',port,'-U','fixture_owner','-d','postgres'],{env,stdio:['pipe','pipe','pipe']})
        sessions.add(this)
        this.child.stdout.on('data',chunk=>{
            this.buffer+=chunk.toString()
            while(this.buffer.includes('\n')) {
                const index=this.buffer.indexOf('\n'),line=this.buffer.slice(0,index).replace(/\r$/,'');this.buffer=this.buffer.slice(index+1)
                if(this.pending && line===this.pending.marker){const p=this.pending;this.pending=null;clearTimeout(p.timer);p.resolve(p.lines)}
                else if(this.pending && line.trim()) this.pending.lines.push(line)
            }
        })
        this.child.stderr.on('data',chunk=>{this.errors+=chunk.toString()})
        this.child.on('error',error=>this.reject(error))
        this.child.on('exit',(code,signal)=>{this.exited=true;this.reject(Object.assign(new Error(`psql ${name} exited ${code ?? signal}: ${this.errors}`),{sqlstate:this.errors.match(/ERROR:\s+([A-Z0-9]{5}):/)?.[1]}));sessions.delete(this)})
    }
    reject(error){if(this.pending){clearTimeout(this.pending.timer);this.pending.reject(error);this.pending=null}}
    query(sql){
        assert.equal(this.pending,null,`Overlapping query on session ${this.name}`)
        assert.ok(!this.exited,`Closed session ${this.name}`)
        return new Promise((resolve,reject)=>{
            const marker=`BE_END_${this.name}_${++this.serial}`
            const timer=setTimeout(()=>{this.reject(new Error(`Bounded query timeout: ${this.name}`));this.child.kill('SIGTERM')},12000)
            this.pending={marker,resolve,reject,timer,lines:[]}
            this.child.stdin.write(`${sql};\n\\echo ${marker}\n`)
        })
    }
    async json(sql){const rows=await this.query(sql);assert.equal(rows.length,1);return rows[0]==='t' ? true : rows[0]==='f' ? false : JSON.parse(rows[0])}
    async rpc(name,args){return this.json(sqlCall(name,args))}
    async close(){if(this.exited)return;this.child.stdin.end('\\q\n');await new Promise(resolve=>{this.child.once('exit',resolve);setTimeout(()=>{if(!this.exited)this.child.kill('SIGTERM');resolve()},500).unref()})}
}
async function connect(name,role){
    const s=new Session(name)
    await s.query(`set application_name=${literal(`be_records_${name}`)};set statement_timeout='8s';set lock_timeout='6s';set idle_in_transaction_session_timeout='10s'${role ? `;set role ${role}` : ''}`)
    s.pid=await s.json('select pg_backend_pid()')
    return s
}
let admin
async function waitBlocked(s,locktype){
    const until=Date.now()+3000
    while(Date.now()<until){
        const found=await admin.json(`select coalesce(jsonb_agg(locktype),'[]') from pg_locks where pid=${s.pid} and not granted`)
        if(locktype ? found.includes(locktype) : found.length)return found
        await new Promise(resolve=>setTimeout(resolve,10))
    }
    throw new Error(`Session ${s.name} never reached expected ${locktype ?? 'row'} lock wait`)
}
async function denies(name,role,sql,code){
    const s=await connect(`denied_${results.length}`,role)
    try {await assert.rejects(s.query(sql),e=>e.sqlstate===code);pass(name,{sqlstate:code})}finally{await s.close()}
}
const count = (table,where='true') => admin.json(`select count(*)::int from ${table} where ${where}`)
try {
    await source('scripts/validate-records-postgres-concurrency.mjs')
    execFileSync(path.join(bin,'initdb'),['-D',data,'--username=fixture_owner','--auth-local=trust','--auth-host=reject','--encoding=UTF8','--locale=C'],{env,stdio:'pipe',timeout:20000})
    startAttempted=true
    execFileSync(path.join(bin,'pg_ctl'),['-D',data,'-l',path.join(temporary,'server.log'),'-o',`-k ${socket} -p ${port} -c listen_addresses='' -c unix_socket_permissions=0700 -c max_connections=12 -c shared_buffers=16MB`,'-w','-t','15','start'],{env,stdio:'pipe',timeout:20000})
    serverStarted=true;admin=await connect('admin')
    const version=await admin.json('select to_json(version())');observations.push({name:'runtime',version,tcpListeners:await admin.json("select to_json(current_setting('listen_addresses'))"),fixture:'fresh private UNIX socket cluster, synthetic data only'})
    await admin.query(`create schema auth;create role anon;create role authenticated;create role service_role bypassrls;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      create function auth.role() returns text language sql stable as $$select nullif(current_setting('request.jwt.claim.role',true),'')$$;
      create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
      create table user_profiles(user_id uuid primary key,mfa_reenrollment_required boolean not null default false);
      create table workspaces(id uuid primary key,status text not null default 'active');
      create table workspace_memberships(workspace_id uuid references workspaces(id),user_id uuid references auth.users(id),role text,primary key(workspace_id,user_id));
      create table relationships(id uuid primary key,workspace_id uuid references workspaces(id),status text not null default 'active');
      create function set_updated_at() returns trigger language plpgsql as $$begin new.updated_at:=clock_timestamp();return new;end$$`)
    const account=await source('supabase/migrations/20260821120000_account_system_v2.sql')
    for(const name of ['current_session_is_aal2','is_workspace_member']) await admin.query(account.match(new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?\\$\\$;`))[0])
    const canonical=await source('supabase/migrations/20260710120000_canonical_work_items_assets.sql')
    await admin.query(canonical.slice(0,canonical.indexOf('insert into public.work_items')))
    await admin.query("alter table work_items add column visibility text not null default 'workspace' check(visibility in ('workspace','admins_only'))")
    await admin.query(await source('supabase/migrations/20260918130000_workspace_notes.sql'))
    await admin.query(await source('supabase/migrations/20260919091000_note_attachment_links.sql'))
    const privacy=await source('supabase/migrations/20260804110000_admin_okr_maintenance.sql')
    await admin.query(privacy.match(/create or replace function public\.validate_private_work_item_links\(\)[\s\S]*?\$\$;/)[0])
    await admin.query('create trigger validate_private_asset_work_item before insert or update on asset_work_items for each row execute function validate_private_work_item_links()')
    await admin.query(`insert into workspaces(id) values(${literal(W)}),(${literal(OTHER)});
      insert into auth.users(id) values(${literal(ACTOR)}),(${literal(STAFF)});
      insert into workspace_memberships values(${literal(W)},${literal(ACTOR)},'admin'),(${literal(W)},${literal(STAFF)},'staff');
      insert into notes(id,workspace_id,name,description) values(${literal(NOTE)},${literal(W)},'Original','Original description'),(${literal(NOTE2)},${literal(W)},'Second','Second description');
      insert into relationships(id,workspace_id) values(${literal(REL)},${literal(W)}),(${literal(REL2)},${literal(W)}),(${literal(FOREIGN_REL)},${literal(OTHER)});
      insert into assets(id,workspace_id,title,asset_kind) values(${literal(ASSET)},${literal(W)},'Fixture','file'),(${literal(FOREIGN_ASSET)},${literal(OTHER)},'Foreign','file');
      insert into work_items(id,workspace_id,title,visibility) values(${literal(WORK)},${literal(W)},'Fixture','workspace'),(${literal(PRIVATE_WORK)},${literal(W)},'Private fixture','admins_only');
      grant usage on schema public,auth to service_role,authenticated,anon;
      grant select,insert,update,delete on all tables in schema public to service_role;
      grant select,insert,update,delete on notes,note_relationships,note_assets to authenticated;
      grant select on workspace_memberships,workspaces to authenticated`)
    const before=await admin.json("select jsonb_build_object('notes',(select count(*) from notes),'assets',(select count(*) from assets))")
    await denies('original valid note relationship reproduces row-shape defect','service_role',`insert into note_relationships values(${literal(NOTE)},${literal(REL)},${literal(W)},now())`,'42703')
    await denies('original valid note asset reproduces row-shape defect','service_role',`insert into note_assets values(${literal(NOTE)},${literal(ASSET)},${literal(W)},now())`,'42703')
    const integritySql=await source('supabase/migrations/20260923170000_note_attachment_integrity.sql')
    const commandsSql=await source('supabase/migrations/20260923171000_record_attachment_commands.sql')
    const originalTrigger=await admin.json("select to_json(md5(prosrc)) from pg_proc where oid='public.enforce_note_link_workspace()'::regprocedure")
    await denies('failure before A1 commit restores exact original function',undefined,integritySql.replace(/commit;\s*$/i,'select 1/0;commit;'),'22012')
    assert.equal(await admin.json("select to_json(md5(prosrc)) from pg_proc where oid='public.enforce_note_link_workspace()'::regprocedure"),originalTrigger)
    await admin.query(integritySql)
    await denies('failure before A4 commit rolls back table functions grants and index',undefined,commandsSql.replace(/commit;\s*$/i,'select 1/0;commit;'),'22012')
    assert.equal(await admin.json("select to_regclass('public.record_attachment_commands') is null and to_regprocedure('public.create_attachment_record(uuid,uuid,uuid,text,jsonb,text)') is null and to_regclass('public.assets_attachment_choices_idx') is null"),true)
    await admin.query(commandsSql)
    assert.deepEqual(await admin.json("select jsonb_build_object('notes',(select count(*) from notes),'assets',(select count(*) from assets))"),before)
    pass('both exact candidate migrations install without rewriting existing records')
    const a=await connect('a','service_role'),b=await connect('b','service_role')
    assert.notEqual(a.pid,b.pid);pass('concurrent workers have distinct PostgreSQL backends')

    const duplicate=id(100),payload=notePayload()
    await a.query('begin');assert.equal((await a.rpc('create_attachment_record',[W,ACTOR,duplicate,'note',payload])).status,'accepted')
    const second=b.rpc('create_attachment_record',[W,ACTOR,duplicate,'note',payload]);await waitBlocked(b,'advisory')
    assert.equal(await count('notes',`id=${literal(duplicate)}`),0)
    assert.equal(await count('record_attachment_commands',`request_id=${literal(duplicate)}`),0)
    await a.query('commit');assert.equal((await second).record_id,duplicate)
    assert.equal(await count('notes',`id=${literal(duplicate)}`),1);assert.equal(await count('record_attachment_commands',`request_id=${literal(duplicate)}`),1)
    pass('same request waits on advisory lock, then converges to one atomically visible record and receipt')

    const mismatch=id(101);await a.query('begin');await a.rpc('create_attachment_record',[W,ACTOR,mismatch,'note',payload])
    const c=await connect('payload_mismatch','service_role')
    const mismatchError=assert.rejects(c.rpc('create_attachment_record',[W,ACTOR,mismatch,'note',{...payload,title:'Different'}]),e=>e.sqlstate==='P0001')
    await waitBlocked(c,'advisory');await a.query('commit');await mismatchError
    assert.equal(await count('notes',`id=${literal(mismatch)} and name='Synthetic note'`),1)
    pass('conflicting same-request payload waits, then fails without replacing accepted intent')

    const rolled=id(102);await a.query('begin');await a.rpc('create_attachment_record',[W,ACTOR,rolled,'note',payload])
    const retry=b.rpc('create_attachment_record',[W,ACTOR,rolled,'note',payload]);await waitBlocked(b,'advisory');await a.query('rollback')
    assert.equal((await retry).record_id,rolled);assert.equal(await count('notes',`id=${literal(rolled)}`),1)
    pass('aborted first transaction leaves no acceptance; waiting retry creates exactly once')

    const lost=id(103);await a.rpc('create_attachment_record',[W,ACTOR,lost,'note',payload]);await a.close()
    const replacement=await connect('replacement','service_role');assert.equal((await replacement.rpc('create_attachment_record',[W,ACTOR,lost,'note',payload])).record_id,lost)
    pass('acknowledgement discarded after committed create replays original record on a new connection')

    await replacement.query('begin');assert.equal((await replacement.rpc('save_note_text',[W,ACTOR,NOTE,'name','First edit','Original'])).ok,true)
    const edit=b.rpc('save_note_text',[W,ACTOR,NOTE,'name','Competing edit','Original']);await waitBlocked(b);await replacement.query('commit')
    assert.deepEqual({ok:(await edit).ok,conflict:(await edit).conflict,value:(await edit).value},{ok:false,conflict:true,value:'First edit'})
    pass('simultaneous same-field edits serialize and stale writer receives authoritative conflict')

    await replacement.query('begin');await replacement.rpc('save_note_text',[W,ACTOR,NOTE,'name','Second edit','First edit'])
    const independent=b.rpc('save_note_text',[W,ACTOR,NOTE,'description','Description edit','Original description']);await waitBlocked(b);await replacement.query('commit');assert.equal((await independent).ok,true)
    assert.deepEqual(await admin.json(`select jsonb_build_array(name,description) from notes where id=${literal(NOTE)}`),['Second edit','Description edit'])
    pass('simultaneous different-field edits preserve both values after lock wait')

    await replacement.rpc('edit_note_relationships',[W,ACTOR,NOTE,[REL],[]]);await replacement.query('begin')
    await replacement.rpc('edit_note_relationships',[W,ACTOR,NOTE,[REL2],[]])
    const delta=b.rpc('edit_note_relationships',[W,ACTOR,NOTE,[],[REL]]);await waitBlocked(b);await replacement.query('commit')
    assert.deepEqual(await delta,[REL2]);pass('concurrent link delta preserves unseen addition and removes only explicit baseline link')

    await replacement.query('begin');await replacement.query(sqlCall('attach_existing_record',[W,ACTOR,'relationship',REL,'note',NOTE2]))
    const attach=b.query(sqlCall('attach_existing_record',[W,ACTOR,'relationship',REL,'note',NOTE2]));await waitBlocked(b);await replacement.query('commit');await attach
    assert.equal(await count('note_relationships',`note_id=${literal(NOTE2)} and relationship_id=${literal(REL)}`),1)
    pass('concurrent exact attachment pair waits and remains unique')

    await replacement.query('begin');await replacement.query(sqlCall('attach_existing_record',[W,ACTOR,'note',NOTE,'note',NOTE2]))
    const reverse=b.query(sqlCall('attach_existing_record',[W,ACTOR,'note',NOTE2,'note',NOTE]));await waitBlocked(b);await replacement.query('commit');await reverse
    assert.equal(await count('note_notes',`(parent_note_id=${literal(NOTE)} and attached_note_id=${literal(NOTE2)}) or (parent_note_id=${literal(NOTE2)} and attached_note_id=${literal(NOTE)})`),2)
    pass('opposite note-link directions use ordered note locks and finish without deadlock')

    await replacement.query('begin')
    await replacement.rpc('create_attachment_record',[W,ACTOR,id(104),'note',notePayload({relationship_ids:[],asset_ids:[],work_item_id:null,note_id:null})])
    assert.equal((await b.rpc('create_attachment_record',[W,ACTOR,id(105),'note',notePayload({relationship_ids:[],asset_ids:[],work_item_id:null,note_id:null})])).status,'accepted')
    await replacement.query('commit');pass('unrelated create request completes while another independent request remains uncommitted')

    await denies('foreign link delta rejects before deleting existing links','service_role',sqlCall('edit_note_relationships',[W,ACTOR,NOTE,[FOREIGN_REL],[REL2]]),'P0001')
    assert.deepEqual(await replacement.rpc('edit_note_relationships',[W,ACTOR,NOTE,[],[]]),[REL2]);pass('failed relationship change retains all prior links')
    const privateCreate=id(110),privatePayload=assetPayload(privateCreate,{work_item_id:PRIVATE_WORK})
    await replacement.query('begin');assert.equal((await replacement.rpc('create_attachment_record',[W,ACTOR,privateCreate,'asset',privatePayload])).status,'rejected')
    const delayed=b.rpc('create_attachment_record',[W,ACTOR,privateCreate,'asset',privatePayload]);await waitBlocked(b,'advisory');await replacement.query('commit')
    assert.equal((await delayed).status,'rejected');assert.equal(await count('assets',`id=${literal(privateCreate)}`),0);assert.equal(await count('asset_relationships',`asset_id=${literal(privateCreate)}`),0)
    await admin.query(`update work_items set visibility='workspace' where id=${literal(PRIVATE_WORK)}`)
    assert.equal((await b.rpc('create_attachment_record',[W,ACTOR,privateCreate,'asset',privatePayload])).status,'rejected')
    pass('late link-trigger failure rolls back parent and prior links; waiting and repaired-target retries stay terminally rejected')

    for(const [name,mutate] of [['wrong actor path',p=>({...p,storage_path:p.storage_path.replace(ACTOR,STAFF)})],['null size',p=>({...p,file_size:null})],['oversized upload',p=>({...p,file_size:524288001})]]){
        const request=id(120+results.length),response=await b.rpc('create_attachment_record',[W,ACTOR,request,'asset',mutate(assetPayload(request))])
        assert.equal(response.status,'rejected');assert.equal(await count('assets',`id=${literal(request)}`),0);pass(`SQL upload provenance rejects ${name} without inserting asset`)
    }
    const expired=id(160),expiryPayload=assetPayload(expired)
    await replacement.query('begin');assert.equal((await replacement.rpc('create_attachment_record',[W,ACTOR,expired,'asset',expiryPayload,'upload_expired'])).status,'rejected')
    const expireRetry=b.rpc('create_attachment_record',[W,ACTOR,expired,'asset',expiryPayload]);await waitBlocked(b,'advisory');await replacement.query('commit');assert.equal((await expireRetry).status,'rejected')
    pass('expiry rejection wins its request lock; later verification cannot resurrect the same upload request')
    const acceptedAsset=id(161),acceptedPayload=assetPayload(acceptedAsset)
    await replacement.query('begin');await replacement.rpc('create_attachment_record',[W,ACTOR,acceptedAsset,'asset',acceptedPayload])
    const oldReceipt=b.rpc('create_attachment_record',[W,ACTOR,acceptedAsset,'asset',acceptedPayload,'upload_expired']);await waitBlocked(b,'advisory');await replacement.query('commit');assert.equal((await oldReceipt).record_id,acceptedAsset)
    pass('accepted upload creation wins its request lock and returns original record to expired-receipt retry')

    for(const role of ['anon','authenticated']) {
        for(const [name,args] of [['attach_existing_record',[W,ACTOR,'note',NOTE,'asset',ASSET]],['save_note_text',[W,ACTOR,NOTE,'name','Unauthorized','Second edit']],['edit_note_relationships',[W,ACTOR,NOTE,[],[]]],['create_attachment_record',[W,ACTOR,id(170),'note',payload]]]) await denies(`${role} cannot execute ${name}`,role,sqlCall(name,args),'42501')
        await denies(`${role} cannot read command receipts`,role,'select * from record_attachment_commands','42501')
    }
    for(const [name,actor,workspace] of [['staff',STAFF,W],['foreign workspace',ACTOR,OTHER]]) await denies(`${name} cannot create through service command`,'service_role',sqlCall('create_attachment_record',[workspace,actor,id(171),'note',payload]),'P0001')
    const rls=await connect('rls','authenticated')
    await rls.query(`set request.jwt.claim.sub=${literal(STAFF)};set request.jwt.claim.role='authenticated';set request.jwt.claims='{"aal":"aal2"}'`)
    assert.equal(await rls.json('select count(*)::int from notes'),0);pass('actual notes RLS hides admin notes from authenticated staff')
    await rls.query(`set request.jwt.claim.sub=${literal(ACTOR)};set request.jwt.claims='{"aal":"aal1"}'`)
    assert.equal(await rls.json('select count(*)::int from notes'),0);pass('actual MFA-aware membership policy hides notes at aal1')
    await rls.query(`set request.jwt.claims='{"aal":"aal2"}'`)
    assert.ok((await rls.json('select count(*)::int from notes'))>0);pass('actual notes RLS allows authorized aal2 admin')

    await admin.query(`update workspace_memberships set role='staff' where workspace_id=${literal(W)} and user_id=${literal(ACTOR)}`)
    await denies('revoked actor cannot replay even an accepted receipt','service_role',sqlCall('create_attachment_record',[W,ACTOR,lost,'note',payload]),'P0001')
    await admin.query(`update workspace_memberships set role='admin' where workspace_id=${literal(W)} and user_id=${literal(ACTOR)}`)
    await admin.query(`update workspaces set status='archived' where id=${literal(W)}`)
    await denies('inactive workspace cannot mutate notes','service_role',sqlCall('save_note_text',[W,ACTOR,NOTE,'name','Denied','Second edit']),'P0001')
    await admin.query(`update workspaces set status='active' where id=${literal(W)}`)

    // Revoke after verified lock waits, not before dispatch. Authorization failures must not finalize receipts.
    const revoking=id(175),revokingPayload=notePayload({relationship_ids:[],asset_ids:[],work_item_id:null,note_id:null})
    await admin.query(`begin;select pg_advisory_xact_lock(hashtextextended(${literal(W+ACTOR+revoking)},0))`)
    const revokingWriter=await connect('revoking_writer','service_role')
    const revoked=assert.rejects(revokingWriter.rpc('create_attachment_record',[W,ACTOR,revoking,'note',revokingPayload]),e=>e.sqlstate==='P0001');await waitBlocked(revokingWriter,'advisory')
    const controller=await connect('controller')
    await controller.query(`update workspace_memberships set role='staff' where workspace_id=${literal(W)} and user_id=${literal(ACTOR)}`)
    await admin.query('commit');await revoked
    assert.equal(await count('notes',`id=${literal(revoking)}`),0);assert.equal(await count('record_attachment_commands',`request_id=${literal(revoking)}`),0)
    pass('revocation during advisory wait denies create without parent or terminal receipt')
    await admin.query(`update workspace_memberships set role='admin' where workspace_id=${literal(W)} and user_id=${literal(ACTOR)}`)
    const admissionSnapshot=()=>admin.json(`select jsonb_build_object('note',(select to_jsonb(n) from notes n where id=${literal(NOTE)}),'links',(select coalesce(jsonb_agg(to_jsonb(r) order by relationship_id),'[]') from note_relationships r where note_id=${literal(NOTE)}),'assets',(select coalesce(jsonb_agg(to_jsonb(a) order by asset_id),'[]') from note_assets a where note_id=${literal(NOTE)}),'receipts',(select count(*) from record_attachment_commands))`)
    for(const [name,command,args] of [
        ['text','save_note_text',[W,ACTOR,NOTE,'name','Must not save','Second edit']],
        ['delta','edit_note_relationships',[W,ACTOR,NOTE,[REL],[]]],
        ['attach','attach_existing_record',[W,ACTOR,'note',NOTE,'asset',ASSET]],
        ['create','create_attachment_record',[W,ACTOR,id(178),'note',notePayload()]],
    ]){
        const snapshot=await admissionSnapshot()
        await admin.query(`begin;select id from notes where id=${literal(NOTE)} for update`)
        const writer=await connect(`revoke_note_${name}`,'service_role')
        const rejected=assert.rejects(writer.query(sqlCall(command,args)),e=>e.sqlstate==='P0001');await waitBlocked(writer)
        await controller.query(`update workspace_memberships set role='staff' where workspace_id=${literal(W)} and user_id=${literal(ACTOR)}`)
        await admin.query('commit');await rejected
        assert.deepEqual(await admissionSnapshot(),snapshot)
        await controller.query(`update workspace_memberships set role='admin' where workspace_id=${literal(W)} and user_id=${literal(ACTOR)}`)
        pass(`revocation during note wait denies ${name} with unchanged fields links and receipts`)
    }
    const archival=id(176)
    await admin.query(`begin;select id from notes where id=${literal(NOTE)} for update`)
    const archiving=b.rpc('create_attachment_record',[W,ACTOR,archival,'note',notePayload()]);await waitBlocked(b)
    await controller.query(`update relationships set status='archived' where id=${literal(REL)}`)
    await admin.query('commit')
    assert.equal((await archiving).status,'rejected');assert.equal(await count('notes',`id=${literal(archival)}`),0)
    pass('relationship archived before parent-note release is rejected after parent-first lock wait')
    await admin.query(`update relationships set status='active' where id=${literal(REL)}`)
    await admin.query(`begin;select id from work_items where id=${literal(WORK)} for update`)
    const archivedAssetRequest=id(179),archivedAssetCreate=b.rpc('create_attachment_record',[W,ACTOR,archivedAssetRequest,'note',notePayload()]);await waitBlocked(b)
    await controller.query(`update assets set metadata='{"archived_at":"synthetic"}' where id=${literal(ASSET)}`)
    await admin.query('commit');assert.equal((await archivedAssetCreate).status,'rejected')
    assert.equal(await count('notes',`id=${literal(archivedAssetRequest)}`),0)
    pass('asset archival during later work-item lock wait is caught by final eligible-target recheck')
    await admin.query(`update assets set metadata='{}' where id=${literal(ASSET)}`)
    await admin.query(`begin;select id from assets where id=${literal(ASSET)} for update`)
    const archiveAttach=await connect('archive_attach','service_role')
    const archiveAttachFailure=assert.rejects(archiveAttach.query(sqlCall('attach_existing_record',[W,ACTOR,'relationship',REL,'asset',ASSET])),e=>e.sqlstate==='P0001');await waitBlocked(archiveAttach)
    await controller.query(`update relationships set status='archived' where id=${literal(REL)}`)
    await admin.query('commit');await archiveAttachFailure
    pass('attachment owner archival during later asset lock wait is caught before insert')
    await admin.query(`update relationships set status='active' where id=${literal(REL)}`)

    const limitNote=id(177),manyRelationships=Array.from({length:21},(_,i)=>id(300+i))
    await admin.query(`insert into notes(id,workspace_id,name,description) values(${literal(limitNote)},${literal(W)},'Limit fixture','Synthetic');insert into relationships(id,workspace_id) values ${manyRelationships.map(rel=>`(${literal(rel)},${literal(W)})`).join(',')}`)
    await replacement.rpc('edit_note_relationships',[W,ACTOR,limitNote,manyRelationships.slice(0,19),[]])
    await replacement.query('begin');await replacement.rpc('edit_note_relationships',[W,ACTOR,limitNote,[manyRelationships[19]],[]])
    const limitWriter=await connect('limit_writer','service_role')
    const limitFailure=assert.rejects(limitWriter.rpc('edit_note_relationships',[W,ACTOR,limitNote,[manyRelationships[20]],[]]),e=>e.sqlstate==='P0001')
    await waitBlocked(limitWriter);await replacement.query('commit');await limitFailure
    assert.equal(await count('note_relationships',`note_id=${literal(limitNote)}`),20);pass('competing relationship deltas cannot overrun the twenty-link limit')
    await denies('attach-existing cannot add twenty-first relationship','service_role',sqlCall('attach_existing_record',[W,ACTOR,'relationship',manyRelationships[20],'note',limitNote]),'P0001')
    await b.query(sqlCall('attach_existing_record',[W,ACTOR,'relationship',manyRelationships[19],'note',limitNote]))
    assert.equal(await count('note_relationships',`note_id=${literal(limitNote)}`),20);pass('existing attachment retry at cap succeeds without changing any links')
    await replacement.rpc('edit_note_relationships',[W,ACTOR,limitNote,[],[manyRelationships[19]]])
    await replacement.query('begin');await replacement.query(sqlCall('attach_existing_record',[W,ACTOR,'relationship',manyRelationships[19],'note',limitNote]))
    const mixedWriter=await connect('mixed_limit_writer','service_role')
    const mixedFailure=assert.rejects(mixedWriter.rpc('edit_note_relationships',[W,ACTOR,limitNote,[manyRelationships[20]],[]]),e=>e.sqlstate==='P0001')
    await waitBlocked(mixedWriter);await replacement.query('commit');await mixedFailure
    assert.equal(await count('note_relationships',`note_id=${literal(limitNote)}`),20);pass('attach-existing wins last slot and concurrent edit rolls back without removing links')
    await replacement.rpc('edit_note_relationships',[W,ACTOR,limitNote,[],[manyRelationships[19]]])
    await replacement.query('begin');await replacement.rpc('edit_note_relationships',[W,ACTOR,limitNote,[manyRelationships[19]],[]])
    const mixedAttach=await connect('mixed_limit_attach','service_role')
    const mixedAttachFailure=assert.rejects(mixedAttach.query(sqlCall('attach_existing_record',[W,ACTOR,'relationship',manyRelationships[20],'note',limitNote])),e=>e.sqlstate==='P0001')
    await waitBlocked(mixedAttach);await replacement.query('commit');await mixedAttachFailure
    assert.equal(await count('note_relationships',`note_id=${literal(limitNote)}`),20);pass('edit wins last slot and concurrent attach-existing refuses addition without removing links')

    // An injected unexpected database failure must remain retryable: no partial record or false terminal receipt.
    await admin.query(`create function fixture_failure() returns trigger language plpgsql as $$begin if new.name='Injected failure' then raise exception using errcode='XX000',message='Synthetic internal failure';end if;return new;end$$;create trigger fixture_failure after insert on notes for each row execute function fixture_failure()`)
    const internal=id(180),internalPayload=notePayload({title:'Injected failure'})
    await denies('unexpected internal database failure is not classified as rejected','service_role',sqlCall('create_attachment_record',[W,ACTOR,internal,'note',internalPayload]),'XX000')
    assert.equal(await count('notes',`id=${literal(internal)}`),0);assert.equal(await count('record_attachment_commands',`request_id=${literal(internal)}`),0)
    await admin.query('drop trigger fixture_failure on notes;drop function fixture_failure()')
    assert.equal((await b.rpc('create_attachment_record',[W,ACTOR,internal,'note',internalPayload])).record_id,internal)
    pass('unexpected failure leaves no partial state or receipt and same intent succeeds after repair')

    // Simulate DDL failure within the migration transaction in a fresh schema state, not a real rollback/drop.
    const ddl=await connect('ddl');await ddl.query('begin;create table fixture_ddl_rollback(id int)')
    await assert.rejects(ddl.query("select 1/0"),e=>e.sqlstate==='22012')
    assert.equal(await admin.json("select to_regclass('public.fixture_ddl_rollback') is null"),true)
    pass('failed PostgreSQL DDL transaction rolls back its earlier table creation')

    const inventoryRows=await admin.query(await source('scripts/records-sql-preflight.sql'))
    assert.equal(inventoryRows.length,1)
    const inventory=JSON.parse(inventoryRows[0])
    assert.equal(inventory.tables.find(table=>table.name==='record_attachment_commands').rls,true)
    assert.equal(inventory.functions.filter(fn=>fn.signature.startsWith('create_attachment_record(')).length,1)
    pass('read-only installation inventory executes and reports installed command schema')
    observations.push({name:'installed candidate function fingerprints',functions:await admin.json("select jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'body_md5',md5(p.prosrc),'security_definer',p.prosecdef,'config',p.proconfig,'grants',p.proacl) order by p.proname) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('enforce_note_link_workspace','assert_record_attachment_admin','attach_existing_record','save_note_text','edit_note_relationships','create_attachment_record')")})
    observations.push({name:'unverified boundaries',items:['not a full production-schema clone','no live R2 signature/conditional PUT/CORS/HEAD operation','no authenticated browser or production latency claim','authorization and eligibility rechecked at write admission after known lock acquisition; later revocation or non-key changes are not serialized','foreign-key checks, unique insertion and arbitrary installed triggers can wait after admission; no new commit-time linearizability claim']})
    outcome='passed'
} finally {
    await Promise.allSettled([...sessions].map(s=>s.close()))
    let stopped=!startAttempted
    if(startAttempted){
        try{execFileSync(path.join(bin,'pg_ctl'),['-D',data,'-m','immediate','-w','-t','10','stop'],{env,stdio:'pipe',timeout:15000});stopped=true}
        catch(error){
            try{execFileSync(path.join(bin,'pg_ctl'),['-D',data,'status'],{env,stdio:'pipe',timeout:5000})}
            catch(statusError){if(statusError.status===3)stopped=true}
            if(!stopped)observations.push({name:'cleanup error',error:String(error),retainedTemporaryDirectory:temporary})
        }
    }
    const report={outcome,passed:results.length,productionCalls:0,externalDeliveryCalls:0,serverStarted,serverStopped:stopped,sources,results,observations}
    if(evidencePath)await writeFile(evidencePath,`${JSON.stringify(report,null,2)}\n`)
    console.log(JSON.stringify({outcome,passed:results.length,productionCalls:0,serverStopped:stopped,evidencePath:evidencePath??null}))
    if(stopped)await rm(temporary,{recursive:true,force:true})
}
