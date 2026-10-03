import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
const repositoryRoot = fileURLToPath(new URL('../', import.meta.url))

export async function buildCommunicationReferencesRelease() {
    const relative='supabase/migrations/20261003120000_communication_record_references.sql'
    const source=await readFile(join(repositoryRoot,relative),'utf8')
    const sha256=createHash('sha256').update(source).digest('hex')
    const sources=[]
    for(const name of(await readdir(join(repositoryRoot,'supabase/migrations'))).filter(name=>name.endsWith('.sql')).sort())sources.push(await readFile(join(repositoryRoot,'supabase/migrations',name),'utf8'))
    const names=['native_conversation_can_read','current_session_is_aal2','workspace_user_can_access_work_item','workspace_user_can_access_relationship','workspace_user_can_access_asset']
    const policyHashes={}
    for(const name of names) {
        const pattern=new RegExp(`create(?: or replace)? function public\\.${name}\\([\\s\\S]*?\\$\\$;`,'gi')
        const definition=sources.flatMap(sql=>[...sql.matchAll(pattern)].map(match=>match[0])).at(-1)
        const functionBody=definition?.match(/as \$\$([\s\S]*?)\$\$;/i)?.[1]
        assert.ok(functionBody,`current canonical policy ${name}`)
        policyHashes[`public.${name}(${name==='current_session_is_aal2'?'':name==='native_conversation_can_read'?'uuid,uuid':'uuid,uuid,uuid'})`]=createHash('md5').update(functionBody).digest('hex')
    }
    const guard=`do $guard$\ndeclare item record; actual text;\nbegin\n    if to_regprocedure('public.read_communication_references(text,uuid,uuid,text,jsonb)') is not null then raise exception 'Reference RPC already exists: inspect before retrying'; end if;\n    for item in select * from jsonb_each_text('${JSON.stringify(policyHashes)}'::jsonb) loop\n        select md5(p.prosrc) into actual from pg_proc p where p.oid=to_regprocedure(item.key);\n        if actual is distinct from item.value then raise exception 'Canonical policy differs: %',item.key; end if;\n    end loop;\n    if to_regclass('public.work_items_active_library_idx') is null or to_regclass('public.assets_attachment_choices_idx') is null then raise exception 'Indexed recent source windows are required'; end if;\nend $guard$;`
    const wrapper=`-- Exact reviewed source: ${relative}\n-- SHA-256: ${sha256}\n-- Atomic guarded installation. No migration registry/history is reconstructed.\nbegin;\nset local lock_timeout='5s';\nset local statement_timeout='60s';\nset local idle_in_transaction_session_timeout='60s';\n${guard}\ndo $install$\ndeclare source text := $migration$${source}$migration$;\nbegin\n    if encode(sha256(convert_to(source,'UTF8')),'hex') <> '${sha256}' then raise exception 'Migration bytes failed checksum'; end if;\n    execute regexp_replace(regexp_replace(source,'^begin;[[:blank:]]*$','','n'),'^commit;[[:blank:]]*$','','n');\nend $install$;\ncommit;\nselect '20261003120000_communication_record_references' migration,'${sha256}' source_sha256;\n`
    const preflight=`-- Read-only metadata; no client rows or secrets.\nselect current_setting('statement_timeout') statement_timeout,current_setting('server_version') server_version,current_setting('pgrst.db_hoisted_tx_settings',true) hoisted_tx_settings;\nselect rolname,rolconfig from pg_roles where rolname in ('authenticator','service_role');\nselect d.datname,r.rolname,s.setconfig from pg_db_role_setting s left join pg_roles r on r.oid=s.setrole left join pg_database d on d.oid=s.setdatabase where s.setrole in (0,(select oid from pg_roles where rolname='authenticator'),(select oid from pg_roles where rolname='service_role'));\nselect p.oid::regprocedure signature,md5(p.prosrc) body_md5,p.prosecdef,p.proconfig from pg_proc p where p.oid=any(array[${Object.keys(policyHashes).map(name=>`to_regprocedure('${name}')`).join(',')}]);\nselect c.relname,c.reltuples::bigint estimated_rows,pg_total_relation_size(c.oid) bytes from pg_class c where c.oid in ('public.work_items'::regclass,'public.assets'::regclass,'public.relationships'::regclass);\nselect to_regprocedure('public.read_communication_references(text,uuid,uuid,text,jsonb)') existing_rpc,to_regclass('public.work_items_active_library_idx') work_recent_index,to_regclass('public.assets_attachment_choices_idx') asset_recent_index;\n`
    const functionBody=source.match(/as \$function\$([\s\S]*?)\$function\$;/)?.[1]
    assert.ok(functionBody)
    const functionMd5=createHash('md5').update(functionBody).digest('hex')
    const postflight=`-- Read-only installed contract checks.\nselect p.oid::regprocedure signature,md5(p.prosrc) body_md5,md5(p.prosrc)='${functionMd5}' body_matches,p.prosecdef,p.proconfig,p.pronargdefaults,pg_get_function_result(p.oid) result_type,has_function_privilege('service_role',p.oid,'execute') service_execute,has_function_privilege('authenticated',p.oid,'execute') authenticated_execute,has_function_privilege('anon',p.oid,'execute') anon_execute from pg_proc p where p.oid=to_regprocedure('public.read_communication_references(text,uuid,uuid,text,jsonb)');\nselect c.relname,i.indisvalid,i.indisready,pg_get_indexdef(c.oid) definition,pg_relation_size(c.oid) bytes from pg_class c join pg_index i on i.indexrelid=c.oid where c.relnamespace='public'::regnamespace and c.relname like 'comms_reference_%' order by c.relname;\n`
    return {source,wrapper,preflight,postflight,manifest:{migration:relative,sha256,wrapperSha256:createHash('sha256').update(wrapper).digest('hex'),functionMd5,policyHashes}}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
    const output=resolve(process.argv[2]??'/private/tmp/be-comms-reference-release')
    await mkdir(output,{recursive:true})
    const release=await buildCommunicationReferencesRelease()
    for(const[name,value]of Object.entries({ 'install.sql':release.wrapper,'preflight.sql':release.preflight,'postflight.sql':release.postflight,'manifest.json':JSON.stringify(release.manifest,null,2)+'\n'}))await writeFile(join(output,name),value)
    console.log(JSON.stringify({output,...release.manifest},null,2))
}
