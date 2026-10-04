import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildCommunicationReferencesRelease } from './build-communication-references-release.mjs'

const hash = value => createHash('sha256').update(value).digest('hex')
const literal = value => `'${value.replaceAll("'", "''")}'`
const signature = 'public.read_communication_references(text,uuid,uuid,text,jsonb)'
const reviewedMigrationSha256 = 'cc0b0334f3c77c4f9d0fe6a78c32c3fa44147aed60b583c4ac9e21689d5169f3'
const specs = [
    ['comms_reference_work_name_idx','work_items','title'],
    ['comms_reference_asset_name_idx','assets','title'],
    ['comms_reference_relationship_name_idx','relationships','primary_person_name'],
    ['comms_reference_relationship_business_idx','relationships','business_name'],
    ['comms_reference_relationship_recent_idx','relationships',null],
]
function definition(name, table, column) {
    const keys = column ? `workspace_id, "left"(lower((${column} COLLATE "und-x-icu")), 240) COLLATE "C", id` : 'workspace_id, updated_at DESC, id'
    const predicate = table === 'relationships' ? "(status <> 'archived'::text)" : "((metadata ->> 'archived_at'::text) IS NULL)"
    return `CREATE INDEX ${name} ON public.${table} USING btree (${keys}) WHERE ${predicate}`
}
function indexCheck(indexes, requirePresent) {
    const expected = indexes.map(({name,expectedDefinition}) => ({name,definition:expectedDefinition}))
    return `do $indexes$
declare item record; actual record;
begin
    for item in select * from jsonb_to_recordset(${literal(JSON.stringify(expected))}::jsonb) as x(name text,definition text) loop
        select c.oid,c.relkind,i.indisvalid,i.indisready,i.indislive,pg_get_indexdef(c.oid) definition
        into actual from pg_class c left join pg_index i on i.indexrelid=c.oid
        where c.oid=to_regclass('public.'||item.name);
        if not found then
            ${requirePresent ? "raise exception 'Required index missing: %',item.name;" : 'continue;'}
        end if;
        if actual.relkind is distinct from 'i' or actual.definition is distinct from item.definition then
            raise exception 'Index definition differs: %; stop and inspect',item.name;
        end if;
        if actual.indisvalid is distinct from true or actual.indisready is distinct from true or actual.indislive is distinct from true then
            raise exception 'Index is invalid, unready or not live: %; inspect before explicit recovery',item.name;
        end if;
    end loop;
end $indexes$;`
}
function indexStatus(indexes) {
    return `select expected.name,case when c.oid is null then 'missing: create once' else 'verified: skip create' end state,
    i.indisvalid,i.indisready,i.indislive,pg_get_indexdef(c.oid) definition,pg_relation_size(c.oid) bytes
from jsonb_array_elements_text(${literal(JSON.stringify(indexes.map(i=>i.name)))}::jsonb) expected(name)
left join pg_class c on c.oid=to_regclass('public.'||expected.name)
left join pg_index i on i.indexrelid=c.oid order by expected.name;`
}
function readonly(sql) {
    return `begin read only;\nset local search_path='';\nset local statement_timeout='10s';\nset local lock_timeout='1s';\n${sql}\ncommit;\n`
}
function rpcCheck(md5) {
    return `if not exists(select 1 from pg_proc p join pg_language l on l.oid=p.prolang
        where p.oid=to_regprocedure('${signature}') and md5(p.prosrc)='${md5}'
          and p.prosecdef and p.provolatile='s' and l.lanname='plpgsql' and p.prorettype='jsonb'::regtype and p.pronargdefaults=2
          and p.prokind='f' and not p.proleakproof and p.proparallel='u' and p.proargmodes is null
          and p.proargnames=array['p_workspace_slug','p_user_id','p_conversation_id','p_query','p_references']::text[]
          and pg_get_expr(p.proargdefaults,0)='NULL::text, NULL::jsonb'
          and (select array_agg(setting order by setting) from unnest(p.proconfig) setting)=array['plan_cache_mode=force_custom_plan','search_path=""','statement_timeout=3s']::text[]
          and has_function_privilege('service_role',p.oid,'execute')
          and not has_function_privilege('authenticated',p.oid,'execute') and not has_function_privilege('anon',p.oid,'execute')
          and not exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
              where acl.privilege_type='EXECUTE' and acl.grantee not in(p.proowner,(select oid from pg_roles where rolname='service_role')))) then
        raise exception 'Reference RPC definition, settings or grants differ; stop and inspect';
    end if;`
}
export async function buildCommunicationReferencesOnlineRelease() {
    const base = await buildCommunicationReferencesRelease()
    assert.equal(base.manifest.sha256,reviewedMigrationSha256,'Committed migration changed; review a new release explicitly')
    const statements = [...base.source.matchAll(/^create index (comms_reference_\w+) on public\.\w+[\s\S]*?;/gm)]
    assert.equal(statements.length,5)
    const indexes = specs.map(([name,table,column],i) => {
        const original = statements.find(match=>match[1]===name)?.[0]
        assert.ok(original,`reviewed index ${name}`)
        const prefix = `${String(i+1).padStart(2,'0')}-${name}`
        return {name,table,createSql:original.replace(/^create index /,'create index concurrently ')+'\n',expectedDefinition:definition(name,table,column),guardFile:`${prefix}-check.sql`,createFile:`${prefix}-create.sql`,verifyFile:`${prefix}-verify.sql`}
    })
    // The production body was independently compared line-by-line on 2026-10-04:
    // its only differences are leading ASCII indentation. Pin both exact bodies;
    // never normalize arbitrary live policies or widen another policy allowance.
    const workPolicy = 'public.workspace_user_can_access_work_item(uuid,uuid,uuid)'
    assert.equal(base.manifest.policyHashes[workPolicy],'fd1819e41e2f5eafc7839bf7d053377a')
    const allowedPolicyHashes = Object.fromEntries(Object.entries(base.manifest.policyHashes).map(([name,body])=>[name,[body]]))
    allowedPolicyHashes[workPolicy].push('3d2507704e47d40ef66dc760b4975b2b')
    const policyGuard = `do $policies$
declare item record; actual text;
begin
    for item in select * from jsonb_each(${literal(JSON.stringify(allowedPolicyHashes))}::jsonb) loop
        select md5(p.prosrc) into actual from pg_proc p where p.oid=to_regprocedure(item.key);
        if not exists(select 1 from jsonb_array_elements_text(item.value) accepted(body_md5) where accepted.body_md5=actual) then
            raise exception 'Canonical policy differs: %',item.key;
        end if;
    end loop;
    if (select count(*) from pg_class where oid in('public.work_items'::regclass,'public.assets'::regclass,'public.relationships'::regclass) and relkind='r')<>3 then
        raise exception 'Online installation requires three ordinary non-partitioned source tables';
    end if;
    if (select count(*) from pg_index where indexrelid in(to_regclass('public.work_items_active_library_idx'),to_regclass('public.assets_attachment_choices_idx')) and indisvalid and indisready and indislive)<>2 then
        raise exception 'Valid existing recent source indexes are required';
    end if;
end $policies$;`
    const unicodeGuard = base.source.match(/do \$preflight\$[\s\S]*?end \$preflight\$;/)?.[0]
    assert.ok(unicodeGuard)
    const rpcSql = base.source.slice(base.source.indexOf('create function public.read_communication_references(')).replace(/\ncommit;\s*$/,'\n')
    assert.ok(rpcSql.startsWith('create function'))
    assert.ok(!/create index|\bbegin;|\bcommit;/i.test(rpcSql))
    const rpcSqlSha256 = hash(rpcSql)
    const existingRpcGuard = `do $existing_rpc$ begin if to_regprocedure('${signature}') is not null then ${rpcCheck(base.manifest.functionMd5)} end if; end $existing_rpc$;`
    const files = {}
    files['00-preflight.sql'] = `-- Read-only current session settings must be reviewed for the separate concurrent CREATE runs.\nselect pg_backend_pid() backend_pid,current_user,current_setting('statement_timeout') statement_timeout,current_setting('lock_timeout') lock_timeout,current_setting('server_version') server_version,current_setting('pgrst.db_hoisted_tx_settings',true) hoisted_tx_settings;\n${readonly(`${policyGuard}\n${unicodeGuard}\n${existingRpcGuard}\n${indexCheck(indexes,false)}\nselect c.relname,c.relkind,c.reltuples::bigint estimated_rows,pg_total_relation_size(c.oid) bytes from pg_class c where c.oid in('public.work_items'::regclass,'public.assets'::regclass,'public.relationships'::regclass);\nselect pid,state,wait_event_type,wait_event,clock_timestamp()-xact_start transaction_age from pg_stat_activity where datname=current_database() and pid<>pg_backend_pid() and xact_start<clock_timestamp()-interval '30 seconds';\nselect pid,relid::regclass table_name,index_relid::regclass index_name,phase from pg_stat_progress_create_index;\nselect r.rolname,setting from pg_roles r cross join lateral unnest(r.rolconfig) setting where r.rolname in('postgres','authenticator','service_role') and split_part(setting,'=',1) in('statement_timeout','lock_timeout','idle_in_transaction_session_timeout','pgrst.db_hoisted_tx_settings');\nselect d.datname,r.rolname,setting from pg_db_role_setting s left join pg_roles r on r.oid=s.setrole left join pg_database d on d.oid=s.setdatabase cross join lateral unnest(s.setconfig) setting where (s.setrole=0 or r.rolname in('postgres','authenticator','service_role')) and split_part(setting,'=',1) in('statement_timeout','lock_timeout','idle_in_transaction_session_timeout','pgrst.db_hoisted_tx_settings');\n${indexStatus(indexes)}`)}`
    for (const index of indexes) {
        files[index.guardFile] = readonly(`${policyGuard}\n${unicodeGuard}\n${existingRpcGuard}\n${indexCheck([index],false)}\n${indexStatus([index])}`)
        // Exactly one command. SET, DO, BEGIN and multiple DDL statements cannot
        // share this submitted query: PostgreSQL requires a standalone command.
        files[index.createFile] = index.createSql
        files[index.verifyFile] = readonly(`${indexCheck([index],true)}\n${indexStatus([index])}`)
    }
    files['06-install-rpc.sql'] = `-- No index DDL. Install only after all five online indexes verify.\n-- Immutable migration SHA-256: ${base.manifest.sha256}\nbegin;\nset local search_path='';\nset local lock_timeout='5s';\nset local statement_timeout='60s';\nset local idle_in_transaction_session_timeout='30s';\n${policyGuard}\n${unicodeGuard}\n${indexCheck(indexes,true)}\ndo $install$\ndeclare source text := $rpc$${rpcSql}$rpc$;\nbegin\n    if encode(sha256(convert_to(source,'UTF8')),'hex') <> '${rpcSqlSha256}' then raise exception 'RPC source failed checksum'; end if;\n    if to_regprocedure('${signature}') is null then execute source; end if;\n    ${rpcCheck(base.manifest.functionMd5)}\nend $install$;\ncommit;\nselect '${base.manifest.sha256}' migration_sha256,'${rpcSqlSha256}' rpc_source_sha256,'installed or exact existing RPC verified' status;\n`
    files['07-postflight.sql'] = readonly(`${policyGuard}\n${indexCheck(indexes,true)}\ndo $verify$ begin ${rpcCheck(base.manifest.functionMd5)} end $verify$;\n${indexStatus(indexes)}\nselect p.oid::regprocedure signature,md5(p.prosrc) body_md5,p.prosecdef,p.proconfig,p.pronargdefaults,pg_get_userbyid(p.proowner) owner,has_function_privilege('service_role',p.oid,'execute') service_execute,has_function_privilege('authenticated',p.oid,'execute') authenticated_execute,has_function_privilege('anon',p.oid,'execute') anon_execute from pg_proc p where p.oid=to_regprocedure('${signature}');`)
    files['README.md'] = `# Online Comms reference installation\n\nThe committed migration is immutable. Do not run the earlier transactional install.sql on production. This pack creates the same five indexes concurrently, then installs its exact RPC subset. No existing records or migration history are rewritten. The work-item policy accepts only its source fingerprint and the exact observed production fingerprint whose 26 lines differ only in leading ASCII indentation; every other policy remains pinned to one source fingerprint. No live body normalization is used.\n\n1. Verify the target project and pack checksums. Run 00-preflight.sql. Review table sizes, long transactions and active index builds; stop for another build, partitioned tables, policy drift or unexpected index state. Verify PostgREST timeout hoisting separately.\n2. Before any CREATE, verify the execution tool submits a single standalone command outside a transaction and each execution has a server statement_timeout greater than zero and at most 120 seconds. A zero lock_timeout is acceptable only with that verified overall statement bound; a smaller positive lock_timeout is preferred when the supported session already provides one. Use a supported connection with these startup/session settings. A prior SET in a pooled SQL editor does not prove settings persist. A frontend timeout or cancellation does not prove the database query stopped. Do not change database or role-wide defaults to work around this. If the editor cannot guarantee these bounds, use a reviewed persistent connection instead.\n3. Process indexes 01 through 05 sequentially. Run its check file. Missing means run its create file exactly once, as the sole submitted statement. Verified means skip CREATE. A mismatch or invalid/unready index is a hard stop. After CREATE, run its verify file and require exact valid/ready/live success before the next index. Never append SET, BEGIN, DO or another statement to CREATE.\n4. On an error, timeout or ambiguous outcome, inspect index state and pg_stat_progress_create_index before any retry. A concurrent failure may leave an invalid index; this pack neither drops nor replaces it. Resolve that specific state with an explicitly reviewed recovery. There is no IF NOT EXISTS shortcut.\n5. Run 06-install-rpc.sql only after every index verifies. It rejects missing/mismatched/invalid indexes and canonical policy drift, checks exact source bytes, and accepts an already-installed RPC only when body, signature, settings and grants match. Run independent 07-postflight.sql. Then deploy the application.\n\nConcurrent builds permit ordinary writes but still consume CPU/IO and wait for old transactions. They are not zero-impact. PGlite functional validation is not evidence of real concurrent behavior; use the native PostgreSQL rehearsal separately. Official constraints: https://www.postgresql.org/docs/17/sql-createindex.html\n`
    const manifest = {rpcFile:'06-install-rpc.sql',postflightFile:'07-postflight.sql',preflightFile:'00-preflight.sql',migration:base.manifest.migration,migrationSha256:base.manifest.sha256,rpcBodyMd5:base.manifest.functionMd5,rpcSqlSha256,policyHashes:base.manifest.policyHashes,allowedPolicyHashes,indexes,fileSha256:Object.fromEntries(Object.entries(files).map(([name,contents])=>[name,hash(contents)]))}
    return {files,manifest,rpcSql}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
    const output=resolve(process.argv[2]??'/private/tmp/be-comms-reference-online-release')
    const release=await buildCommunicationReferencesOnlineRelease()
    await mkdir(output,{recursive:true})
    for(const[name,value]of Object.entries({...release.files,'manifest.json':JSON.stringify(release.manifest,null,2)+'\n'}))await writeFile(join(output,name),value)
    console.log(JSON.stringify({output,migrationSha256:release.manifest.migrationSha256,rpcSqlSha256:release.manifest.rpcSqlSha256,files:Object.keys(release.files)},null,2))
}
