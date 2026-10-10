import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { baselineReadDefinition, definition, readEfficiencyMigration, sql } from './communication-read-efficiency-fixture.mjs'

const digest = (algorithm, source) => createHash(algorithm).update(source).digest('hex')
const body = source => { const match = source.match(/as \$\$([\s\S]*?)\$\$;/i); assert.ok(match); return match[1] }
const signature = 'public.advance_communication_read(uuid,text,uuid,uuid)'
export async function buildCommunicationReadEfficiencyRelease() {
    const migration = 'supabase/migrations/20261010120000_communication_read_efficiency.sql'
    const source = await readEfficiencyMigration(), baseline = await baselineReadDefinition()
    const candidate = definition(source, 'advance_communication_read')
    const originalMd5 = digest('md5', body(baseline)), candidateMd5 = digest('md5', body(candidate)), sha256 = digest('sha256', source)
    const policyHashes = {}
    for (const [file, name, arguments_] of [
        ['20260821120000_account_system_v2.sql', 'current_session_is_aal2', ''],
        ['20260821120000_account_system_v2.sql', 'is_workspace_member', 'uuid,text[]'],
        ['20260909100000_client_delivery_teams.sql', 'client_conversation_can_access', 'uuid,uuid,uuid'],
        ['20260821150000_encrypted_communications.sql', 'native_conversation_can_read', 'uuid,uuid'],
    ]) policyHashes[`public.${name}(${arguments_})`] = digest('md5', body(definition(await sql(file), name)))
    const guard = permitted => `do $guard$
declare item record; current_body text; target oid := to_regprocedure('${signature}');
begin
    select md5(prosrc) into current_body from pg_catalog.pg_proc where oid=target;
    if current_body is null or current_body <> all(array[${permitted.map(value => `'${value}'`).join(',')}]) then
        raise exception 'Shared read RPC differs from reviewed source; inspect before replacing';
    end if;
    if not exists(select 1 from pg_catalog.pg_proc where oid=target and prosecdef and provolatile='v' and prorettype='jsonb'::regtype and pronargdefaults=0 and proconfig=array['search_path=""'])
       or has_function_privilege('authenticated',target,'execute') is not true
       or has_function_privilege('anon',target,'execute') is not false
       or has_function_privilege('service_role',target,'execute') is not false
       or exists(select 1 from pg_catalog.pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl where p.oid=target and acl.grantee=0 and acl.privilege_type='EXECUTE') then
        raise exception 'Shared read RPC security contract differs';
    end if;
    for item in select * from jsonb_each_text('${JSON.stringify(policyHashes)}'::jsonb) loop
        select md5(prosrc) into current_body from pg_catalog.pg_proc where oid=to_regprocedure(item.key);
        if current_body is distinct from item.value then raise exception 'Canonical policy differs: %',item.key; end if;
    end loop;
end $guard$;`
    const settings = "set local lock_timeout='5s';\nset local statement_timeout='60s';\nset local idle_in_transaction_session_timeout='60s';"
    const install = `-- Exact reviewed source: ${migration}\n-- SHA-256: ${sha256}\n-- No stored rows, grants, policies, tables, indexes or migration history change.\nbegin;\n${settings}\n${guard([originalMd5, candidateMd5])}\ndo $install$\ndeclare source text := $migration$${source}$migration$;\nbegin\n    if encode(sha256(convert_to(source,'UTF8')),'hex') <> '${sha256}' then raise exception 'Migration bytes failed checksum'; end if;\n    execute regexp_replace(regexp_replace(source,'^begin;[[:blank:]]*$','','n'),'^commit;[[:blank:]]*$','','n');\nend $install$;\ncommit;\n`
    const rollback = `-- Restore only the prior reviewed shared read function. Preserve all cursor rows.\nbegin;\n${settings}\n${guard([candidateMd5, originalMd5])}\n${baseline}\nnotify pgrst,'reload schema';\ncommit;\n`
    const signatures = [signature, ...Object.keys(policyHashes)].map(name => `to_regprocedure('${name}')`).join(',')
    const preflight = `-- Read-only schema metadata; no business records.\nselect current_setting('server_version') server_version,current_setting('statement_timeout') statement_timeout;\nselect p.oid::regprocedure signature,md5(p.prosrc) body_md5,p.prosecdef,p.provolatile,p.proconfig,p.pronargdefaults,pg_get_function_result(p.oid) result_type,p.proacl from pg_catalog.pg_proc p where p.oid=any(array[${signatures}]);\nselect has_function_privilege('authenticated','${signature}','execute') authenticated_execute,has_function_privilege('anon','${signature}','execute') anon_execute,has_function_privilege('service_role','${signature}','execute') service_execute;\n`
    const postflight = `-- Read-only exact installed source and retained permission checks.\nselect p.oid::regprocedure signature,md5(p.prosrc) body_md5,md5(p.prosrc)='${candidateMd5}' candidate_matches,p.prosecdef,p.provolatile,p.proconfig,p.proacl from pg_catalog.pg_proc p where p.oid=to_regprocedure('${signature}');\n${preflight}`
    return { source, install, rollback, preflight, postflight, manifest: { migration, sha256, originalMd5, candidateMd5, policyHashes, installSha256: digest('sha256', install), rollbackSha256: digest('sha256', rollback) } }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const directory = resolve(process.argv[2] ?? '/private/tmp/be-communication-read-efficiency-release')
    await mkdir(directory, { recursive: true })
    const release = await buildCommunicationReadEfficiencyRelease()
    for (const [name, value] of Object.entries({ 'install.sql': release.install, 'rollback.sql': release.rollback, 'preflight.sql': release.preflight, 'postflight.sql': release.postflight, 'manifest.json': JSON.stringify(release.manifest, null, 2) + '\n' })) await writeFile(join(directory, name), value)
    console.log(JSON.stringify({ directory, ...release.manifest }, null, 2))
}
