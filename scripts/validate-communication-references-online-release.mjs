import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { buildCommunicationReferencesOnlineRelease } from './build-communication-references-online-release.mjs'
import { createReferenceFixture } from './validate-communication-references-sql.mjs'

const release = await buildCommunicationReferencesOnlineRelease()
const {files,manifest} = release
for(const[name,contents]of Object.entries(files))assert.equal(createHash('sha256').update(contents).digest('hex'),manifest.fileSha256[name])
assert.equal(manifest.indexes.length,5)
for(const index of manifest.indexes) {
    assert.equal(files[index.createFile],index.createSql)
    assert.match(index.createSql,/^create index concurrently comms_reference_\w+ on public\.\w+/)
    assert.equal(index.createSql.split(';').length,2,'exactly one standalone command')
    assert.ok(!/if not exists|\bset\b|\bbegin\b|\bcommit\b/i.test(index.createSql))
}
assert.ok(!/^create index/im.test(files[manifest.rpcFile]),'RPC installer contains no index DDL')
console.log('PASS: online manifest checksums, five standalone concurrent commands, separate RPC transaction')

const clean=await createReferenceFixture({installCandidate:false})
const exec=sql=>clean.db.exec(sql)
const rollback=()=>exec('rollback')
const rpcMissing=async()=>assert.equal((await clean.query("select to_regprocedure('public.read_communication_references(text,uuid,uuid,text,jsonb)') value")).rows[0].value,null)
try {
    await exec(files[manifest.preflightFile])
    await assert.rejects(exec(files[manifest.rpcFile]),/Required index missing/)
    await rollback();await rpcMissing()
    for(const index of manifest.indexes) {
        const before=await exec(files[index.guardFile])
        assert.equal(before.at(-2).rows[0].state,'missing: create once')
        // PGlite verifies index shape and installer behavior, not concurrent
        // locks. The dedicated native PostgreSQL harness executes exact DDL.
        await exec(index.createSql.replace('index concurrently','index'))
        const verified=await exec(files[index.verifyFile])
        assert.equal(verified.at(-2).rows[0].definition,index.expectedDefinition)
        assert.equal(verified.at(-2).rows[0].state,'verified: skip create')
        const retry=await exec(files[index.guardFile])
        assert.equal(retry.at(-2).rows[0].state,'verified: skip create')
    }
    await assert.rejects(exec(files[manifest.rpcFile].replace('-- Only the trusted HTTP owner','-- Corrupted owner comment')),/RPC source failed checksum/)
    await rollback();await rpcMissing()
    await exec(files[manifest.rpcFile])
    await exec(files[manifest.postflightFile])
    await exec(files[manifest.rpcFile])
    await exec(files[manifest.postflightFile])
    console.log('PASS: missing-index refusal, exact index readiness, safe verified skip, source checksum and exact RPC retry')
    await exec('grant execute on function public.read_communication_references(text,uuid,uuid,text,jsonb) to authenticated')
    await assert.rejects(exec(files[manifest.rpcFile]),/settings or grants differ/)
    await rollback()
    await assert.rejects(exec(files[manifest.postflightFile]),/settings or grants differ/)
    await rollback()
    await assert.rejects(exec(files[manifest.indexes[0].guardFile]),/settings or grants differ/)
    await rollback()
    console.log('PASS: existing RPC grant drift fails closed in installation and independent postflight')
} finally {await clean.db.close()}

const broken=await createReferenceFixture({installCandidate:false})
try {
    const first=manifest.indexes[0]
    await broken.db.exec(`create index ${first.name} on public.work_items(id)`)
    await assert.rejects(broken.db.exec(files[first.guardFile]),/Index definition differs/)
    await broken.db.exec('rollback')
    await broken.db.exec(`drop index public.${first.name}`)
    await broken.db.exec(first.createSql.replace('index concurrently','index'))
    // Catalog-state mutation is confined to this disposable synthetic fixture.
    await broken.db.exec(`update pg_index set indisvalid=false where indexrelid='public.${first.name}'::regclass`)
    await assert.rejects(broken.db.exec(files[first.guardFile]),/invalid, unready or not live/)
    await broken.db.exec('rollback')
    await assert.rejects(broken.db.exec(files[manifest.rpcFile]),/invalid, unready or not live/)
    await broken.db.exec('rollback')
    console.log('PASS: same-name mismatched definition and invalid index both prevent retry and RPC installation')
} finally {await broken.db.close()}

const drift=await createReferenceFixture({installCandidate:false})
try {
    await drift.db.exec('create or replace function public.native_conversation_can_read(target_conversation uuid,target_user uuid default auth.uid()) returns boolean language sql stable security definer set search_path=public as $$select true$$;')
    await assert.rejects(drift.db.exec(files[manifest.preflightFile]),/Canonical policy differs/)
    await drift.db.exec('rollback')
    await assert.rejects(drift.db.exec(files[manifest.indexes[0].guardFile]),/Canonical policy differs/)
    await drift.db.exec('rollback')
    await assert.rejects(drift.db.exec(files[manifest.rpcFile]),/Canonical policy differs/)
    await drift.db.exec('rollback')
    console.log('PASS: canonical authorization drift blocks preflight, every index check and RPC installation')
} finally {await drift.db.close()}
const variant=await createReferenceFixture({installCandidate:false})
try {
    const migration=await readFile(new URL('../supabase/migrations/20260927120000_onboarding_review_queue_access.sql',import.meta.url),'utf8')
    const definition=migration.match(/create or replace function public\.workspace_user_can_access_work_item\([\s\S]*?\$\$;/)[0]
    const body=definition.match(/as \$\$([\s\S]*?)\$\$;/)[1]
    // Exactly observed production indentation, captured from 26 lines on 2026-10-04.
    // Quoted contents and every non-leading byte are retained from committed source.
    const indents=[0,58,59,60,61,62,63,64,67,70,75,80,87,96,103,112,121,122,123,124,125,126,127,128,129,129]
    const lines=body.split('\n')
    assert.equal(lines.length,indents.length)
    const observed=lines.map((line,i)=>' '.repeat(indents[i])+line.replace(/^ */,'')).join('\n')
    const md5=value=>createHash('md5').update(value).digest('hex')
    assert.equal(md5(body),'fd1819e41e2f5eafc7839bf7d053377a')
    assert.equal(md5(observed),'3d2507704e47d40ef66dc760b4975b2b')
    assert.equal(Buffer.byteLength(observed),4785)
    assert.deepEqual(observed.split('\n').map(line=>line.replace(/^ */,'')),lines.map(line=>line.replace(/^ */,'')))
    const work='public.workspace_user_can_access_work_item(uuid,uuid,uuid)'
    assert.deepEqual(manifest.allowedPolicyHashes[work],[md5(body),md5(observed)])
    for(const[name,allowed]of Object.entries(manifest.allowedPolicyHashes))if(name!==work)assert.deepEqual(allowed,[manifest.policyHashes[name]])
    await variant.db.exec(definition.replace(body,()=>observed))
    await variant.db.exec(files[manifest.preflightFile])
    for(const index of manifest.indexes){
        await variant.db.exec(files[index.guardFile])
        await variant.db.exec(index.createSql.replace('index concurrently','index'))
    }
    await variant.db.exec(files[manifest.rpcFile])
    await variant.db.exec(files[manifest.postflightFile])
    // Even a further whitespace-only variant is unknown and must remain denied.
    await variant.db.exec(definition.replace(body,()=>observed+' '))
    await assert.rejects(variant.db.exec(files[manifest.indexes[0].guardFile]),/Canonical policy differs/)
    await variant.db.exec('rollback')
    await assert.rejects(variant.db.exec(files[manifest.rpcFile]),/Canonical policy differs/)
    await variant.db.exec('rollback')
    console.log('PASS: exact independently reviewed production indentation fingerprint passes; any unreviewed body still fails closed')
} finally {await variant.db.close()}
console.log('PASS: PGlite online-pack functional checks; real concurrent behavior requires separate native PostgreSQL rehearsal')
