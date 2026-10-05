import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PGlite, repositoryRoot } from './pglite-fixture.mjs'

// This generator only compiles catalog definitions in an empty local database.
// It never connects to a hosted database or invokes an application command.
const hash = value => createHash('sha256').update(value).digest('hex')
const literal = value => `'${value.replaceAll("'", "''")}'`
const migrations = ['20261005220000_service_assignee_transfer.sql', '20261005220500_appointment_service_booking_commands.sql']
const reviewedHashes = ['423191525452ae60180a9713d8730ca49dde7743b7e367fdbc8cce4e172a7647', '6015bd5786a0b89dd024e8e79dac919ebd356c0961e90d2b0e8efb64ab7b9061']
const existing = [
    ['appointment_setting_service_is_available', 'uuid,uuid,uuid', ['service_role'], ['authenticated']],
    ['workspace_user_can_manage_appointment_setting', 'uuid,uuid,uuid,uuid', ['authenticated', 'service_role']],
    ['manage_client_ghl_connection', 'uuid,uuid,text,uuid,uuid,text,text,text,text,jsonb,text', ['service_role']],
    ['save_appointment_setting_draft_command', 'uuid,uuid,uuid,uuid,uuid,timestamptz,uuid,text,jsonb', ['service_role']],
    ['submit_appointment_setting_appointment', 'uuid,uuid,uuid,uuid,uuid,timestamptz,uuid,text,text,text', ['service_role']],
    ['change_service_instance', 'uuid,uuid,uuid,uuid,integer,text,text,uuid,text', ['service_role']],
    ['workspace_shell_bootstrap', 'text,uuid', ['service_role']],
    ['reject_service_instance_history_change', '', [], ['service_role']],
    ['submit_appointment_setting_appointment_queued', 'uuid,uuid,uuid,uuid,uuid,timestamptz,uuid,text,text,text', ['service_role']],
].map(([name, args, grants, optionalGrants = []]) => ({ name, signature: `public.${name}(${args})`, grants, optionalGrants }))
const created = [
    ['current_appointment_service_assignments', 'uuid,uuid'],
    ['service_assignee_can_setup_client', 'uuid,uuid,uuid'],
    ['read_assigned_appointment_services', 'uuid,uuid,uuid'],
    ['preview_service_assignee_transfer', 'uuid,uuid,uuid,uuid,uuid'],
    ['transfer_service_assignee', 'uuid,uuid,uuid,uuid,uuid,jsonb'],
].map(([name, args]) => ({ name, signature: `public.${name}(${args})`, optionalGrants: [] }))
const receipt = 'public.service_assignee_transfer_receipts'
// Dashboard catalog read independently compared byte-for-byte on 2026-10-06:
// this unchanged production function has four ASCII spaces on the otherwise
// empty line after BEGIN. Admit only these two exact bodies; never normalize.
const reviewedBodyVariants = {
    'public.change_service_instance(uuid,uuid,uuid,uuid,integer,text,text,uuid,text)': {
        source: '613caa21cacc64e4e40077fda921537e',
        production: 'b04737ad93933f758456560d91dfd28a',
    },
}
const prerequisiteTables = ['public.workspaces', 'auth.users', 'public.relationships', 'public.relationship_services', 'public.relationship_service_instances', 'public.service_instance_work_items', 'public.work_items', 'public.work_item_relationships', 'public.work_item_assignees', 'public.workspace_memberships', 'public.workspace_member_service_access', 'public.workspace_service_capabilities', 'public.appointment_setting_setup_assignees', 'public.onboarding_services', 'public.onboarding_service_revisions', 'public.appointment_setting_appointments', 'public.appointment_draft_command_receipts', 'public.appointment_notification_outbox']

const functionCatalog = signature => `select jsonb_build_object(
 'body_md5',md5(p.prosrc),'language',l.lanname,'security_definer',p.prosecdef,
 'volatility',p.provolatile,'parallel',p.proparallel,'kind',p.prokind,'leakproof',p.proleakproof,
 'returns',pg_get_function_result(p.oid),'returns_set',p.proretset,'cost',p.procost,'rows',p.prorows,'argnames',p.proargnames,'argmodes',p.proargmodes,
 'defaults',pg_get_expr(p.proargdefaults,0),'default_count',p.pronargdefaults,
 'config',(select coalesce(jsonb_agg(setting order by setting),'[]') from unnest(p.proconfig) setting),
 'owner',pg_get_userbyid(p.proowner),
 'grants',(select coalesce(jsonb_agg(jsonb_build_object('role',case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,'grantable',a.is_grantable) order by case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end),'[]')
   from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.privilege_type='EXECUTE' and a.grantee<>p.proowner),
 'effective_execute',jsonb_build_object('anon',has_function_privilege('anon',p.oid,'EXECUTE'),'authenticated',has_function_privilege('authenticated',p.oid,'EXECUTE'),'service_role',has_function_privilege('service_role',p.oid,'EXECUTE'))
) from pg_proc p join pg_language l on l.oid=p.prolang where p.oid=to_regprocedure(${signature})`

const receiptCatalog = `select jsonb_build_object(
 'kind',c.relkind,'owner',pg_get_userbyid(c.relowner),'rls',c.relrowsecurity,'force_rls',c.relforcerowsecurity,
 'columns',(select jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid),'identity',a.attidentity,'generated',a.attgenerated) order by a.attnum)
   from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped),
 'constraints',(select coalesce(jsonb_agg(jsonb_build_object('name',con.conname,'definition',pg_get_constraintdef(con.oid),'validated',con.convalidated) order by con.conname),'[]') from pg_constraint con where con.conrelid=c.oid and con.contype in ('p','f','u','c','x')),
 'indexes',(select coalesce(jsonb_agg(jsonb_build_object('definition',pg_get_indexdef(i.indexrelid),'valid',i.indisvalid,'ready',i.indisready,'live',i.indislive) order by i.indexrelid::regclass::text),'[]') from pg_index i where i.indrelid=c.oid),
 'triggers',(select coalesce(jsonb_agg(jsonb_build_object('name',t.tgname,'definition',pg_get_triggerdef(t.oid),'enabled',t.tgenabled) order by t.tgname),'[]') from pg_trigger t where t.tgrelid=c.oid and not t.tgisinternal),
 'policies',(select coalesce(jsonb_agg(p.polname order by p.polname),'[]') from pg_policy p where p.polrelid=c.oid),
 'grants',(select coalesce(jsonb_agg(jsonb_build_object('role',case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,'privilege',a.privilege_type,'grantable',a.is_grantable) order by a.grantee,a.privilege_type),'[]') from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a where a.grantee<>c.relowner),
 'column_grants',(select count(*) from pg_attribute a cross join lateral aclexplode(a.attacl) acl where a.attrelid=c.oid and acl.grantee<>c.relowner),
 'effective_privileges',(select jsonb_object_agg(role,privileges) from (select role,jsonb_build_object('select',has_table_privilege(role,c.oid,'SELECT'),'insert',has_table_privilege(role,c.oid,'INSERT'),'update',has_table_privilege(role,c.oid,'UPDATE'),'delete',has_table_privilege(role,c.oid,'DELETE'),'truncate',has_table_privilege(role,c.oid,'TRUNCATE'),'references',has_table_privilege(role,c.oid,'REFERENCES'),'trigger',has_table_privilege(role,c.oid,'TRIGGER')) privileges from unnest(array['anon','authenticated','service_role']) role) permissions)
) from pg_class c where c.oid=to_regclass('${receipt}')`

function allowedContracts(contract, optionalGrants, signature) {
    const contracts = [contract, ...optionalGrants.map(role => ({
        ...contract,
        grants: [...contract.grants, { role, grantable: false }].sort((a, b) => a.role.localeCompare(b.role)),
        effective_execute: { ...contract.effective_execute, [role]: true },
    }))]
    const bodyVariant = reviewedBodyVariants[signature]
    if (bodyVariant) {
        assert.equal(contract.body_md5, bodyVariant.source, 'Reviewed canonical source body changed')
        return [...contracts, ...contracts.map(value => ({ ...value, body_md5: bodyVariant.production }))]
    }
    return contracts
}
function functionGuard(expected) {
    return `do $functions$\ndeclare item record; actual jsonb;\nbegin\n for item in select * from jsonb_each(${literal(JSON.stringify(expected))}::jsonb) loop\n  ${functionCatalog('item.key')} into actual;\n  if actual is null or not exists(select 1 from jsonb_array_elements(item.value) expected(contract) where contract=actual) then raise exception 'Function hash, signature, settings, owner or grants differ: %',item.key; end if;\n end loop;\nend $functions$;`
}
function receiptGuard(expected) {
    return `do $receipt$ declare actual jsonb; begin ${receiptCatalog} into actual; if actual is distinct from ${literal(JSON.stringify(expected))}::jsonb then raise exception 'Transfer receipt schema, RLS, privileges, constraints or immutable trigger differ'; end if; end $receipt$;`
}
function absentGuard() {
    return `do $absent$ declare signature text; begin\n if to_regclass('${receipt}') is not null then raise exception 'Transfer receipt table already exists; inspect independent postflight before any retry'; end if;\n for signature in select jsonb_array_elements_text(${literal(JSON.stringify(created.map(f => f.signature)))}::jsonb) loop\n  if to_regprocedure(signature) is not null then raise exception 'Transfer function already exists: %; inspect before retrying',signature; end if;\n end loop;\nend $absent$;`
}
const environmentGuard = `do $environment$ begin
 if current_user<>'postgres' or current_database()<>'postgres' or current_setting('server_version_num')::integer/10000<>17 then raise exception 'Expected reviewed PostgreSQL 17 postgres database/role; verify target'; end if;
 if exists(select 1 from jsonb_array_elements_text(${literal(JSON.stringify(prerequisiteTables))}::jsonb) expected(name) left join pg_class c on c.oid=to_regclass(name) where c.oid is null or c.relkind<>'r') then raise exception 'Required ordinary source table missing or changed'; end if;
end $environment$;`
const readonly = sql => `begin read only;\nset local search_path='';\nset local statement_timeout='10s';\nset local lock_timeout='1s';\n${sql}\ncommit;\n`
function metadata(expected) {
    const signatures = [...existing, ...created].map(f => f.signature)
    return `select jsonb_build_object('database',current_database(),'user',current_user,'server_version',current_setting('server_version'),'statement_timeout',current_setting('statement_timeout'),'lock_timeout',current_setting('lock_timeout'),
 'functions',(select jsonb_object_agg(signature,jsonb_build_object('actual',(${functionCatalog('signature')}),'expected_match',exists(select 1 from jsonb_array_elements(coalesce(${literal(JSON.stringify(expected))}::jsonb->signature,'[]')) e(contract) where e.contract=(${functionCatalog('signature')})))) from jsonb_array_elements_text(${literal(JSON.stringify(signatures))}::jsonb) f(signature)),
 'receipt',(${receiptCatalog}),
 'prerequisites',(select jsonb_agg(jsonb_build_object('name',name,'present',c.oid is not null,'kind',c.relkind) order by name) from jsonb_array_elements_text(${literal(JSON.stringify(prerequisiteTables))}::jsonb) expected(name) left join pg_class c on c.oid=to_regclass(name))) release_catalog;`
}

export async function buildServiceTransferRelease() {
    const sources = []
    for (const name of (await readdir(join(repositoryRoot, 'supabase/migrations'))).filter(n => n.endsWith('.sql') && n < migrations[0]).sort()) sources.push({ name, source: await readFile(join(repositoryRoot, 'supabase/migrations', name), 'utf8') })
    const baseline = existing.map(spec => {
        const pattern = new RegExp(`create(?: or replace)? function public\\.${spec.name}\\([\\s\\S]*?\\bas\\s+\\$\\$[\\s\\S]*?\\$\\$;`, 'gi')
        const latest = sources.flatMap(({ name, source }) => [...source.matchAll(pattern)].map(match => ({ sourceFile: name, definition: match[0] }))).at(-1)
        assert.ok(latest, `Latest source definition for ${spec.name}`)
        return { ...spec, ...latest }
    })
    const inputs = await Promise.all(migrations.map(async (name, i) => { const source = await readFile(join(repositoryRoot, 'supabase/migrations', name), 'utf8'); const sha256 = hash(source); assert.equal(sha256, reviewedHashes[i], 'Reviewed migration changed; review and repin before generating a release'); return { name, source, sha256 } }))
    const db = new PGlite()
    let before, after, expectedReceipt
    try {
        // No application data and no execution of function bodies. This delegates
        // parsing/default/result normalization to PostgreSQL instead of JS regex.
        await db.exec(`set check_function_bodies=false; create role anon; create role authenticated; create role service_role bypassrls; create schema auth; create function auth.uid() returns uuid language sql as $$select null::uuid$$; create table auth.users(id uuid primary key); create table public.workspaces(id uuid primary key); create table public.relationship_service_instances(workspace_id uuid,id uuid,unique(workspace_id,id));`)
        for (const spec of baseline) {
            await db.exec(spec.definition)
            await db.exec(`revoke all on function ${spec.signature} from public,anon,authenticated,service_role; ${spec.grants.length ? `grant execute on function ${spec.signature} to ${spec.grants.join(',')};` : ''}`)
        }
        await db.exec("set search_path=''")
        before = Object.fromEntries(await Promise.all(baseline.map(async spec => [spec.signature, allowedContracts((await db.query(functionCatalog(literal(spec.signature)))).rows[0].jsonb_build_object, spec.optionalGrants, spec.signature)])))
        for (const input of inputs) await db.exec(input.source)
        after = Object.fromEntries(await Promise.all([...baseline, ...created].map(async spec => [spec.signature, allowedContracts((await db.query(functionCatalog(literal(spec.signature)))).rows[0].jsonb_build_object, spec.optionalGrants, spec.signature)])))
        expectedReceipt = (await db.query(receiptCatalog)).rows[0].jsonb_build_object
    } finally { await db.close() }
    for (const spec of baseline.slice(5)) assert.deepEqual(after[spec.signature], before[spec.signature], `${spec.name} must remain unchanged`)
    assert.equal(after[created[0].signature][0].effective_execute.service_role, false, 'Internal helper must have an explicit service_role revoke for deterministic default ACLs')
    const installBlocks = inputs.map(({ source, sha256 }, i) => {
        const tag = `$migration_${i}$`
        assert.ok(!source.includes(tag))
        assert.equal((source.match(/^begin;[ \t]*$/gm) ?? []).length, 1)
        assert.equal((source.match(/^commit;[ \t]*$/gm) ?? []).length, 1)
        return `do $install_${i}$\ndeclare source text := ${tag}${source}${tag};\nbegin\n if encode(sha256(convert_to(source,'UTF8')),'hex')<>'${sha256}' then raise exception 'Migration ${i + 1} source checksum differs'; end if;\n -- Strip exactly the two reviewed outer transaction lines; keep every other byte.\n execute regexp_replace(source,'^(begin;|commit;)[[:blank:]]*$','','gn');\nend $install_${i}$;`
    })
    const checks = `${functionGuard(after)}\n${receiptGuard(expectedReceipt)}`
    const files = {
        '00-preflight.sql': readonly(`-- Catalog metadata only. Verify dashboard project lhxrgapdrkwdaunwgeje independently.\n${metadata(before)}`),
        '01-install.sql': `-- Atomic install of exactly two additive migrations. No business-row reads or registry writes.\n-- Verify project lhxrgapdrkwdaunwgeje outside SQL before submission.\nbegin;\nset local search_path='';\nset local lock_timeout='5s';\nset local statement_timeout='60s';\nset local idle_in_transaction_session_timeout='60s';\n${environmentGuard}\n${functionGuard(before)}\n${absentGuard()}\n${installBlocks.join('\n')}\n${checks}\ncommit;\nselect 'service-assignee-transfer' release,'verified atomic installation' status,${literal(JSON.stringify(inputs.map(({name, sha256}) => ({name, sha256}))))}::jsonb migrations;\n`,
        '02-postflight.sql': readonly(`${environmentGuard}\n${checks}\n${metadata(after)}`),
    }
    files['README.md'] = `# Service assignee transfer release\n\nThis pack embeds the exact bytes of two additive migrations and checks both SHA-256 values before DDL. Its single transaction removes only each source's outer BEGIN/COMMIT lines. Existing client/user/work/message data and migration history are not read or rewritten. There are no new indexes on existing tables and no provider calls. The unchanged canonical change_service_instance function accepts its source body and the exact production body b04737ad93933f758456560d91dfd28a independently inspected on 2026-10-06; the only difference is four ASCII spaces on an otherwise blank line after BEGIN. Its other settings and permissions remain exact, and no function body is normalized or replaced.\n\n1. Confirm the signed-in Supabase dashboard project is lhxrgapdrkwdaunwgeje and independently recompute source and generated-file SHA-256 values against manifest.json. SQL database/role names alone do not establish project identity. Never print credentials.\n2. Run 00-preflight.sql. It is bounded and read-only; review actual definitions/owners/settings/ACLs and expected_match for all nine existing functions. All five new functions and the receipt table must be absent. Required tables must be ordinary tables. Stop on drift; do not normalize bodies or replay migration history. Availability helper authenticated EXECUTE and immutable-history helper service_role EXECUTE are the only optional existing ACLs, because their historical source leaves those inherited grants untouched. Every other grant is exact.\n3. Run 01-install.sql exactly once using the audited SQL Editor path. It repeats all guards immediately before DDL and verifies the final catalog before committing. PostgreSQL 17, database postgres and role postgres are pinned. Lock waits are bounded at 5 seconds; each source preserves its reviewed statement timeout (60/15 seconds), and the wrapper bounds idle transactions to 60 seconds. An ambiguous UI result is not permission to retry.\n4. Independently run 02-postflight.sql. It verifies every new/changed function body, signature, defaults, language, security mode, settings and permissions; exact receipt columns/keys/RLS/no policies/no client or service-role table grants; immutable trigger; and unchanged canonical service change, shell bootstrap, history trigger and queued-notification wrapper. Compare before/after optional existing ACLs exactly. If postflight passes after an ambiguous install, do not rerun installation. If neither full baseline nor full final contract holds, stop and investigate metadata only.\n5. Deploy only the reviewed exact app commit after required CI. Verify the terminal production deployment and read-only artifact smoke separately. Do not invoke transfer, booking, message or GHL commands against real records for smoke. This local catalog compilation complements the full functional SQL fixtures; it does not validate production performance, authenticated UI or physical devices.\n\nRegenerate with BE_PGLITE_ROOT=/tmp/betelgeze-library-sql node scripts/build-service-transfer-release.mjs <output-directory>. The optional PGlite dependency is tooling only. The generator uses check_function_bodies=false solely in an empty local database to parse function metadata without reproducing all application tables; production scripts do not disable validation.\n`
    const manifest = {
        projectRef: 'lhxrgapdrkwdaunwgeje',
        migrations: inputs.map(({ name, sha256 }) => ({ name, sha256 })),
        baselineSources: baseline.map(({ signature, sourceFile, definition }) => ({ signature, sourceFile, definitionSha256: hash(definition) })),
        before, after, reviewedBodyVariants, receipt: expectedReceipt,
        fileSha256: Object.fromEntries(Object.entries(files).map(([name, source]) => [name, hash(source)])),
    }
    return { files, manifest }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const output = resolve(process.argv[2] ?? '/private/tmp/be-service-transfer-release')
    const release = await buildServiceTransferRelease()
    await mkdir(output, { recursive: true })
    for (const [name, value] of Object.entries({ ...release.files, 'manifest.json': JSON.stringify(release.manifest, null, 2) + '\n' })) await writeFile(join(output, name), value)
    console.log(JSON.stringify({ output, migrations: release.manifest.migrations, fileSha256: release.manifest.fileSha256 }, null, 2))
}
