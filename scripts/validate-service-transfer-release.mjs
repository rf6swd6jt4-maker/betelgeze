import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { buildServiceTransferRelease } from './build-service-transfer-release.mjs'
import { PGlite } from './pglite-fixture.mjs'

// Release-wrapper/catalog validation only. Functional authorization and command
// tests live in the two service-transfer SQL fixtures with body checking enabled.
const release = await buildServiceTransferRelease()
// PGlite 0.5.8 embeds PostgreSQL 18; production pack keeps its reviewed PG17
// guard. Only this local harness substitutes the engine-major guard. Catalog
// comparison uses PG17-compatible fields (NOT NULL is checked via pg_attribute).
const engine = new PGlite()
const engineMajor = Math.floor(Number((await engine.query("select current_setting('server_version_num') version")).rows[0].version) / 10000)
await engine.close()
assert.equal(engineMajor, 18)
const localSql = sql => sql.replace("current_setting('server_version_num')::integer/10000<>17", `current_setting('server_version_num')::integer/10000<>${engineMajor}`)
const baselineSql = []
const canonicalSignature = 'public.change_service_instance(uuid,uuid,uuid,uuid,integer,text,text,uuid,text)'
let canonicalDefinition
for (const spec of release.manifest.baselineSources) {
    const source = await readFile(new URL(`../supabase/migrations/${spec.sourceFile}`, import.meta.url), 'utf8')
    const name = spec.signature.slice('public.'.length, spec.signature.indexOf('('))
    const definition = [...source.matchAll(new RegExp(`create(?: or replace)? function public\\.${name}\\([\\s\\S]*?\\bas\\s+\\$\\$[\\s\\S]*?\\$\\$;`, 'gi'))].at(-1)?.[0]
    assert.equal(createHash('sha256').update(definition).digest('hex'), spec.definitionSha256)
    if (spec.signature === canonicalSignature) canonicalDefinition = definition
    const grants = release.manifest.before[spec.signature].at(-1).grants.map(g => g.role)
    baselineSql.push(`${definition}\nrevoke all on function ${spec.signature} from public,anon,authenticated,service_role;${grants.length ? `grant execute on function ${spec.signature} to ${grants.join(',')};` : ''}`)
}
async function fixture() {
    const db = new PGlite()
    await db.exec(`set check_function_bodies=false; create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create function auth.uid() returns uuid language sql as $$ select null::uuid $$;
      create table auth.users(id uuid primary key); create table public.workspaces(id uuid primary key);
      create table public.relationship_service_instances(workspace_id uuid,id uuid,unique(workspace_id,id));`)
    for (const name of ['relationships','relationship_services','service_instance_work_items','work_items','work_item_relationships','work_item_assignees','workspace_memberships','workspace_member_service_access','workspace_service_capabilities','appointment_setting_setup_assignees','onboarding_services','onboarding_service_revisions','appointment_setting_appointments','appointment_draft_command_receipts','appointment_notification_outbox']) await db.exec(`create table public.${name}(id uuid)`)
    for (const definition of baselineSql) await db.exec(definition)
    // Exercise Supabase-style inherited function grants for newly created funcs.
    await db.exec('alter default privileges in schema public grant execute on functions to anon,authenticated,service_role;')
    return db
}
const catalog = async (db, name) => (await db.exec(localSql(release.files[name]))).flatMap(r => r.rows).find(r => r.release_catalog)?.release_catalog
const baseline = async db => {
    const result = await catalog(db, '00-preflight.sql')
    for (const signature of Object.keys(release.manifest.before)) assert.equal(result.functions[signature].expected_match, true, signature)
    assert.equal(result.receipt, null)
    for (const signature of Object.keys(release.manifest.after).filter(s => !release.manifest.before[s])) assert.equal(result.functions[signature].actual, null)
    return result
}
const rejected = async (db, sql, pattern) => { await assert.rejects(db.exec(localSql(sql)), pattern); await db.exec('rollback'); }
const db = await fixture()
try {
    const before = await baseline(db)
    await db.exec(localSql(release.files['01-install.sql']))
    const after = await catalog(db, '02-postflight.sql')
    for (const signature of Object.keys(release.manifest.after)) assert.equal(after.functions[signature].expected_match, true, signature)
    for (const signature of release.manifest.baselineSources.slice(5).map(s => s.signature)) assert.deepEqual(after.functions[signature].actual, before.functions[signature].actual)
    assert.deepEqual(after.functions['public.appointment_setting_service_is_available(uuid,uuid,uuid)'].actual.grants, before.functions['public.appointment_setting_service_is_available(uuid,uuid,uuid)'].actual.grants)
    console.log('PASS exact atomic wrapper and independent postflight; optional inherited baseline ACLs preserved; internal helper denied under default grants')
    await rejected(db, release.files['01-install.sql'], /Function hash|already exists/)
    await catalog(db, '02-postflight.sql')
    await db.exec('grant select on public.service_assignee_transfer_receipts to authenticated')
    await rejected(db, release.files['02-postflight.sql'], /receipt schema/)
    console.log('PASS repeated install rejected; independent receipt privilege drift detected')
} finally { await db.close() }

const guarded = await fixture()
try {
    await baseline(guarded)
    const lateTamper = release.files['01-install.sql'].replace('-- relationship\'s aggregate lifecycle.', '-- relationship\'s aggregate lifecycle!')
    assert.notEqual(lateTamper, release.files['01-install.sql'])
    await rejected(guarded, lateTamper, /Migration 2 source checksum differs/)
    await baseline(guarded)
    console.log('PASS second-migration checksum rejection rolls back all first-migration DDL')
    const lateFailure = release.files['01-install.sql'].replace(/\ncommit;\nselect/, "\ndo $fault$ begin raise exception 'forced late verification failure'; end $fault$;\ncommit;\nselect")
    assert.notEqual(lateFailure, release.files['01-install.sql'])
    await rejected(guarded, lateFailure, /forced late verification failure/)
    await baseline(guarded)
    console.log('PASS failure after both migrations rolls back every catalog change')
    await guarded.exec('grant execute on function public.workspace_shell_bootstrap(text,uuid) to anon')
    await rejected(guarded, release.files['01-install.sql'], /Function hash, signature, settings, owner or grants differ/)
    assert.equal((await guarded.query("select to_regclass('public.service_assignee_transfer_receipts') receipt")).rows[0].receipt, null)
    console.log('PASS baseline permission drift blocks before installation')
} finally { await guarded.close() }

const productionVariant = await fixture()
try {
    const exactProductionDefinition = canonicalDefinition.replace('\nbegin\n\n', '\nbegin\n    \n')
    assert.notEqual(exactProductionDefinition, canonicalDefinition)
    const body = exactProductionDefinition.match(/as \$\$([\s\S]*?)\$\$;/)[1]
    assert.equal(createHash('md5').update(body).digest('hex'), 'b04737ad93933f758456560d91dfd28a')
    const alteredDefinition = exactProductionDefinition.replace('Version and request ID are required', 'Changed validation text')
    assert.notEqual(alteredDefinition, exactProductionDefinition)
    await productionVariant.exec(alteredDefinition)
    await rejected(productionVariant, release.files['01-install.sql'], /Function hash, signature, settings, owner or grants differ/)
    assert.equal((await productionVariant.query("select to_regclass('public.service_assignee_transfer_receipts') receipt")).rows[0].receipt, null)
    await productionVariant.exec(exactProductionDefinition)
    const before = await baseline(productionVariant)
    await productionVariant.exec(localSql(release.files['01-install.sql']))
    const after = await catalog(productionVariant, '02-postflight.sql')
    assert.deepEqual(after.functions[canonicalSignature].actual, before.functions[canonicalSignature].actual)
    assert.equal(after.functions[canonicalSignature].actual.body_md5, 'b04737ad93933f758456560d91dfd28a')
    await productionVariant.exec(alteredDefinition)
    await rejected(productionVariant, release.files['02-postflight.sql'], /Function hash, signature, settings, owner or grants differ/)
    console.log('PASS exact reviewed production whitespace variant stays unchanged; non-whitespace body drift rejected before and after install')
} finally { await productionVariant.close() }
