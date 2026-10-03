import assert from 'node:assert/strict'
import { createReferenceFixture } from './validate-communication-references-sql.mjs'
import { buildCommunicationReferencesRelease } from './build-communication-references-release.mjs'
const release=await buildCommunicationReferencesRelease()
const {db,query}=await createReferenceFixture({installCandidate:false})
try {
    const missing=async()=>assert.equal((await query("select to_regprocedure('public.read_communication_references(text,uuid,uuid,text,jsonb)') value")).rows[0].value,null)
    await assert.rejects(db.exec(release.wrapper.replace('-- On-demand internal chat reference discovery','-- Altered source')),/Migration bytes failed checksum/)
    await db.exec('rollback');await missing()
    await db.exec("begin; create or replace function public.native_conversation_can_read(target_conversation uuid,target_user uuid default auth.uid()) returns boolean language sql stable security definer set search_path=public as $$select true$$; commit;")
    await assert.rejects(db.exec(release.wrapper),/Canonical policy differs/)
    await db.exec('rollback');await missing()
    console.log('PASS: checksum corruption and canonical-policy drift abort before reference DDL')
} finally {await db.close()}
const clean=await createReferenceFixture({installCandidate:false})
try {
    await clean.db.exec(release.wrapper)
    const rows=await clean.db.exec(release.postflight)
    const rpc=rows[0].rows[0]
    assert.equal(rpc.body_matches,true)
    assert.equal(rpc.prosecdef,true)
    assert.equal(rpc.service_execute,true)
    assert.equal(rpc.authenticated_execute,false)
    assert.equal(rpc.anon_execute,false)
    assert.equal(rows[1].rows.length,5)
    assert.ok(rows[1].rows.every(row=>row.indisvalid&&row.indisready))
    await assert.rejects(clean.db.exec(release.wrapper),/already exists/)
    await clean.db.exec('rollback')
    assert.equal((await clean.db.exec(release.postflight))[0].rows[0].body_matches,true)
    console.log('PASS: exact guarded installer/readback, five valid indexes, server-only RPC and retry guard')
} finally {await clean.db.close()}
