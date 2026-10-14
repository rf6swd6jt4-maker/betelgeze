import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {PGlite} from '../pglite-fixture.mjs'
import {fixtureSql} from './fixture.mjs'
const [input,pack]=process.argv.slice(2)
assert.ok(input&&pack,'Usage: validate-release.mjs <reviewed-catalog.json> <release-directory>')
const baseline=JSON.parse(await readFile(input,'utf8'))[0].result,db=new PGlite()
try{
 await db.exec(await fixtureSql())
 for(const f of baseline.functions){
  await db.exec(f.definition)
  await db.exec(`revoke all on function ${f.signature} from public,anon,authenticated,service_role`)
  for(const acl of f.acl){const role=acl.split('=')[0];assert.ok(['postgres','authenticated','service_role'].includes(role));await db.exec(`grant execute on function ${f.signature} to ${role}`)}
 }
 const install=await readFile(pack+'/01-install.sql','utf8')
 const major=(await db.query("select current_setting('server_version_num')::integer/10000 major")).rows[0].major
 // Only the explicit runtime guard changes in this disposable rehearsal;
 // the embedded migration, baseline guards and final postconditions are exact.
 assert.equal(install.split("server_version_num')::integer/10000<>17").length,2)
 await db.exec(install.replace("server_version_num')::integer/10000<>17",`server_version_num')::integer/10000<>${major}`))
 await db.exec(await readFile(pack+'/02-postflight.sql','utf8'))
 assert.equal((await db.query('select count(*)::int n from service_queue_receipts')).rows[0].n,0)
 await assert.rejects(db.exec(install.replace("server_version_num')::integer/10000<>17",`server_version_num')::integer/10000<>${major}`)),/Baseline drift|New table exists/)
 await db.exec('rollback')
 console.log(JSON.stringify({atomicInstall:true,independentPostflight:true,reinstallRejected:true,clientMutations:0,localPostgresMajor:major,productionGuard:17}))
}finally{await db.close()}
