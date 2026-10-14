// Offline release pack builder. Input is an independently reviewed catalog read;
// it contains function definitions/ACLs only, never credentials or client rows.
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {readFile,mkdir,writeFile} from 'node:fs/promises'
import {PGlite} from '../pglite-fixture.mjs'
import {fixtureSql,migration} from './fixture.mjs'
const [input,output]=process.argv.slice(2)
assert.ok(input&&output,'Usage: build-release.mjs <reviewed-catalog.json> <output-directory>')
const baseline=JSON.parse(await readFile(input,'utf8'))[0].result
assert.equal(baseline.new_table,null);assert.equal(baseline.registry,null);assert.equal(baseline.functions.length,11)
const hash=(value,algorithm='sha256')=>createHash(algorithm).update(value).digest('hex')
const literal=s=>"'"+s.replaceAll("'","''")+"'"
const source=await migration(),db=new PGlite();let after
try{
 await db.exec(await fixtureSql())
 for(const f of baseline.functions){
  const local=(await db.query('select prosrc from pg_proc where oid=$1::regprocedure',[f.signature])).rows[0].prosrc
  // Only the inspected production work-ACL indentation variant is admitted.
  if(local!==f.body){assert.equal(f.signature,'workspace_user_can_access_work_item(uuid,uuid,uuid)');assert.equal(hash(f.body,'md5'),'3d2507704e47d40ef66dc760b4975b2b');assert.equal(local.split('\n').map(x=>x.trim()).filter(Boolean).join('\n'),f.body.split('\n').map(x=>x.trim()).filter(Boolean).join('\n'))}
  await db.exec(f.definition)
 }
 await db.exec(source)
 after=(await db.query("select p.oid::regprocedure::text signature,md5(p.prosrc) body_md5,p.prosecdef security_definer,p.proconfig config,p.provolatile volatility,l.lanname language from pg_proc p join pg_language l on l.oid=p.prolang where p.pronamespace='public'::regnamespace and (p.proname like '%service_queue%' or p.proname in ('shared_queue_command','queue_actor_is_working') or p.oid=any($1::regprocedure[])) order by p.proname",[baseline.functions.map(f=>f.signature)])).rows
}finally{await db.close()}
const tables=['service_queue_rosters','service_queue_members','service_queue_chat_members','service_queue_activity','service_queue_receipts']
const entries=['read_service_queue_roster','save_service_queue_roster','shared_queue_command']
const beforeChecks=baseline.functions.map(f=>`if not exists(select 1 from pg_proc p where p.oid=to_regprocedure(${literal(f.signature)}) and md5(pg_get_functiondef(p.oid))=${literal(hash(f.definition,'md5'))} and to_jsonb(p.proacl)=${literal(JSON.stringify(f.acl))}::jsonb and pg_get_userbyid(p.proowner)=${literal(f.owner)}) then raise exception 'Baseline drift: ${f.signature}';end if;`).join('\n')
const afterChecks=after.map(f=>{
 const old=baseline.functions.find(x=>x.signature===f.signature)
 return `if not exists(select 1 from pg_proc p join pg_language l on l.oid=p.prolang where p.oid=to_regprocedure(${literal(f.signature)}) and md5(p.prosrc)=${literal(f.body_md5)} and p.prosecdef=${f.security_definer} and p.provolatile=${literal(f.volatility)} and l.lanname=${literal(f.language)} and coalesce(to_jsonb(p.proconfig),'null'::jsonb)=${literal(JSON.stringify(f.config))}::jsonb and pg_get_userbyid(p.proowner)='postgres' ${old?`and to_jsonb(p.proacl)=${literal(JSON.stringify(old.acl))}::jsonb`:`and not has_function_privilege('anon',p.oid,'execute') and not has_function_privilege('authenticated',p.oid,'execute') and has_function_privilege('service_role',p.oid,'execute')=${entries.includes(f.signature.split('(')[0])}`}) then raise exception 'Final function drift: ${f.signature}';end if;`
}).join('\n')
const tableChecks=tables.map(t=>`if not exists(select 1 from pg_class where oid=to_regclass('public.${t}') and relrowsecurity and relkind='r') or exists(select 1 from pg_policy where polrelid='public.${t}'::regclass) or exists(select 1 from unnest(array['anon','authenticated','service_role']) role where has_table_privilege(role,'public.${t}','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')) then raise exception 'Table policy/grant drift: ${t}';end if;`).join('\n')
const history="if to_regclass('supabase_migrations.schema_migrations') is not null then raise exception 'Migration registry changed; inspect without replay';end if;"
const checks=`do $verify$ begin ${afterChecks}\n${tableChecks}\n${history} end $verify$;`
const absent=[...tables.map(t=>`if to_regclass('public.${t}') is not null then raise exception 'New table exists; inspect postflight before retry';end if;`),...after.filter(f=>!baseline.functions.some(b=>b.signature===f.signature)).map(f=>`if to_regprocedure(${literal(f.signature)}) is not null then raise exception 'New function exists; inspect postflight before retry';end if;`)].join('\n')
const digest=hash(source)
const install=`begin;set local lock_timeout='5s';set local statement_timeout='60s';set local idle_in_transaction_session_timeout='60s';
do $guard$ begin if current_database()<>'postgres' or current_user<>'postgres' or current_setting('server_version_num')::integer/10000<>17 then raise exception 'Wrong database/runtime';end if;${history}\n${beforeChecks}\n${absent} end $guard$;
do $install$ declare source text:=$migration$${source}$migration$;begin if encode(sha256(convert_to(source,'UTF8')),'hex')<>${literal(digest)} then raise exception 'Migration digest mismatch';end if;execute regexp_replace(source,'^(begin;|commit;)[[:blank:]]*$','','gn');end $install$;
${checks}\ncommit;select 'shared-service-queue' release,'verified' status;\n`
await mkdir(output,{recursive:true})
const files={'01-install.sql':install,'02-postflight.sql':`begin read only;set local statement_timeout='30s';${checks}\ncommit;select 'shared-service-queue' release,'postflight verified' status;\n`}
for(const [name,value] of Object.entries(files))await writeFile(output+'/'+name,value,{mode:0o600})
await writeFile(output+'/manifest.json',JSON.stringify({migration:'20261014120000_shared_service_queue.sql',migrationSha256:digest,files:Object.fromEntries(Object.entries(files).map(([name,value])=>[name,hash(value)])),before:baseline.functions.map(f=>({signature:f.signature,definitionMd5:hash(f.definition,'md5'),acl:f.acl})),after},null,2),{mode:0o600})
console.log(JSON.stringify({output,migrationSha256:digest,functions:after.length,files:Object.keys(files)}))
