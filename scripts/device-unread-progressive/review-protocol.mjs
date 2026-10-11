// Independent protocol review of the isolated SQL candidate. Never connects to
// production. Sequential transactions establish behavior, not concurrency speed.
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { createProgressiveDatabase, id } from './sql-fixture.mjs'

const output = process.argv[2] ?? '/private/tmp/device-unread-progressive-review-protocol.json'
const f = await createProgressiveDatabase({ chats: 6, devices: 1, backlog: 4 })
const { db, ids, conversations } = f
const { w, me, other, deviceA, deviceB, sessionA, sessionB, newDevice, newSession } = ids
const [client, native] = conversations
const report = {
  observedAt: new Date().toISOString(),
  scope: 'Independent SQL protocol diagnostic against canonical access/read functions, held device functions, and proposed preview batch',
  limitations: [
    'PGlite, one connection, synthetic rows; no concurrent transaction, WAL, replication, HTTP, encryption, deployment or physical-device evidence.',
    'Installation-cookie loss is represented by a newly bound installation ID, not an actual browser or cookie test.',
    'Account cursor preservation is checked; push worker/activity/provider behavior is not executed.',
    'Authenticating RPC guards are exercised with synthetic signed-claim context; actual cookie/JWT verification remains outside this fixture.',
  ], cases: [], sourceHashes: {},
}
for (const name of ['sql-fixture.mjs', 'sql-base.mjs', 'sql-held-device.sql', 'sql-preview.sql']) {
  report.sourceHashes[name] = createHash('sha256').update(await readFile(new URL(name, import.meta.url))).digest('hex')
}
const cursor = async (deviceId, conversationId) => (await db.query('select last_read_message_id as id,last_read_at::text as at from communication_device_read_cursors where workspace_id=$1 and user_id=$2 and device_id=$3 and conversation_id=$4', [w, me, deviceId, conversationId])).rows[0]
const shared = async c => {
  const table = c.kind === 'client' ? 'communication_read_cursors' : 'workspace_native_read_cursors'
  const key = c.kind === 'client' ? 'relationship_id' : 'conversation_id'
  return (await db.query(`select last_read_message_id as id,last_read_at::text as at from ${table} where workspace_id=$1 and user_id=$2 and ${key}=$3`, [w, me, c.id])).rows[0]
}
const count = async (conversationId, deviceId = deviceA) => (await f.summary({ deviceId })).conversations.find(row => row.conversationId === conversationId)?.count ?? 0
const batch = async c => (await f.batch({ kind: c.kind, conversationIds: [c.id] })).items[0]
const advance = async (c, messageId = c.latestMessageId, deviceId = deviceA, device = true) => f.read({ kind: c.kind, conversationId: c.id, messageId, deviceId, device })
async function denied(work, code) {
  await db.exec('savepoint expected_denial')
  let rejected
  try { await work() } catch (error) { rejected = error }
  finally { await db.exec('rollback to savepoint expected_denial; release savepoint expected_denial') }
  assert.ok(rejected, 'Expected a rejected operation')
  assert.equal(rejected.code, code)
}
async function check(name, run) {
  await db.exec('begin')
  try { await f.setClaims(); await run(); report.cases.push({ name, passed: true }) }
  catch (error) { report.cases.push({ name, passed: false, error: String(error), code: error.code }); process.exitCode = 1 }
  finally { await db.exec('rollback'); await writeFile(output, JSON.stringify(report, null, 2)) }
}
try {
  for (const c of [client, native]) {
    await check(`${c.kind}: reading A advances shared receipt but not sleeping known B`, async () => {
      assert.equal(await count(c.id), 4)
      await advance(c)
      assert.equal(await count(c.id), 0)
      assert.equal((await shared(c)).id, c.latestMessageId)
      await f.setClaims({ ...f.claims, session_id: sessionB })
      assert.equal(await count(c.id, deviceB), 4)
      assert.equal((await cursor(deviceB, c.id)).id, c.firstMessageId)
    })
    await check(`${c.kind}: old shared reader does not clear an initialized device`, async () => {
      await advance(c, c.latestMessageId, deviceA, false)
      assert.equal((await shared(c)).id, c.latestMessageId)
      assert.equal(await count(c.id), 4)
      assert.equal((await cursor(deviceA, c.id)).id, c.firstMessageId)
    })
    await check(`${c.kind}: older device ACK cannot regress shared or device cursor`, async () => {
      await advance(c)
      const aheadShared = await shared(c), aheadDevice = await cursor(deviceA, c.id)
      const ack = await advance(c, c.firstMessageId)
      assert.deepEqual(await shared(c), aheadShared)
      assert.deepEqual(await cursor(deviceA, c.id), aheadDevice)
      assert.equal(ack.deviceCursor.lastReadMessageId, c.latestMessageId)
      assert.equal(ack.cursor.lastReadMessageId, c.latestMessageId)
    })
    await check(`${c.kind}: deleted higher frontier survives a lower preview`, async () => {
      await advance(c)
      const table = c.kind === 'client' ? 'client_messages' : 'workspace_native_messages'
      await db.query(`delete from ${table} where id=$1`, [c.latestMessageId])
      const item = await batch(c)
      assert.equal(item.cursorKnown, true)
      assert.equal(item.deviceCursor.lastReadMessageId, c.latestMessageId)
      assert.notEqual(item.preview.id, c.latestMessageId)
      assert.equal(await count(c.id), 0)
      await denied(() => advance(c), '22023')
      assert.equal((await cursor(deviceA, c.id)).id, c.latestMessageId)
    })
    await check(`${c.kind}: deleted same-time cursor leaves later UUID unread`, async () => {
      const table = c.kind === 'client' ? 'client_messages' : 'workspace_native_messages'
      const key = c.kind === 'client' ? 'relationship_id' : 'conversation_id'
      const roleColumn = c.kind === 'client' ? 'direction' : 'sender_user_id'
      const roleValue = c.kind === 'client' ? 'inbound' : other
      const low = id(c.kind === 'client' ? 810 : 820), high = id(c.kind === 'client' ? 811 : 821)
      const at = '2026-10-01 10:00:00.123456+00'
      await db.query(`insert into ${table}(id,workspace_id,${key},${roleColumn},created_at,body) values($1,$2,$3,$4,$5,'lower tie'),($6,$2,$3,$4,$5,'higher tie')`, [low,w,c.id,roleValue,at,high])
      await advance(c, low)
      await db.query(`delete from ${table} where id=$1`, [low])
      const item = await batch(c)
      assert.equal(item.deviceCursor.lastReadMessageId, low)
      assert.match(item.deviceCursor.lastReadAt, /\.123456/)
      assert.equal(item.preview.id, high)
      assert.equal(await count(c.id), 1)
      await advance(c, high)
      assert.equal(await count(c.id), 0)
    })
    await check(`${c.kind}: complete batch proves no cursor, rather than unknown`, async () => {
      await db.query('delete from communication_device_read_cursors where device_id=$1 and conversation_id=$2', [deviceA,c.id])
      const item = await batch(c)
      assert.equal(item.cursorKnown, true)
      assert.equal(item.deviceCursor, null)
      assert.equal(await count(c.id), 5)
    })
    await check(`${c.kind}: revoked access denies preview/read and removes summary`, async () => {
      const before = await cursor(deviceA,c.id)
      if (c.kind === 'client') await db.query('update relationships set seller_user_id=null where id=$1', [c.id])
      else await db.query('delete from workspace_native_conversation_participants where conversation_id=$1 and user_id=$2',[c.id,me])
      await denied(() => batch(c), '42501')
      await denied(() => advance(c), '42501')
      assert.equal(await count(c.id), 0)
      assert.deepEqual(await cursor(deviceA,c.id), before)
    })
  }
  await check('native: clear boundary excludes body/count without erasing saved frontier', async () => {
    const before = await cursor(deviceA,native.id)
    await db.query('insert into workspace_native_conversation_visibility values($1,$2,$3)',[native.id,me,'2099-01-01'])
    assert.equal((await batch(native)).preview, null)
    assert.equal(await count(native.id), 0)
    assert.deepEqual(await cursor(deviceA,native.id), before)
  })
  await check('native: own messages remain previews but do not become unread', async () => {
    await db.query('update workspace_native_messages set sender_user_id=$1 where conversation_id=$2',[me,native.id])
    assert.equal(await count(native.id), 0)
    assert.equal((await batch(native)).preview.id,native.latestMessageId)
  })
  await check('new observed installation seeds current account; sleeping known installation retains cutover', async () => {
    await f.setAccountAhead()
    await db.query('insert into auth.sessions values($1,$2,null)',[newSession,me])
    await db.query('insert into account_session_devices values($1,$2,$3)',[newSession,me,newDevice])
    await f.setClaims({...f.claims,session_id:newSession})
    assert.equal((await f.summary({deviceId:newDevice})).conversations.length,0)
    assert.equal((await cursor(newDevice,client.id)).id,client.latestMessageId)
    await f.setClaims({...f.claims,session_id:sessionB})
    assert.equal((await f.summary({deviceId:deviceB})).conversations.length,6)
  })
  await check('same installation survives expired/deleted auth session when observed in a new session', async () => {
    await advance(client)
    const before=await cursor(deviceA,client.id)
    await db.query('delete from auth.sessions where id=$1',[sessionA])
    await db.query('insert into auth.sessions values($1,$2,null)',[newSession,me])
    await db.query('insert into account_session_devices values($1,$2,$3)',[newSession,me,deviceA])
    await f.setClaims({...f.claims,session_id:newSession})
    assert.deepEqual(await cursor(deviceA,client.id),before)
    assert.equal(await count(client.id),0)
  })
  await check('lost cookie represented as new installation cannot recover old device unread history', async () => {
    await f.setAccountAhead()
    assert.equal(await count(client.id),4)
    await db.query('insert into auth.sessions values($1,$2,null)',[newSession,me])
    await db.query('insert into account_session_devices values($1,$2,$3)',[newSession,me,newDevice])
    await f.setClaims({...f.claims,session_id:newSession})
    assert.equal(await count(client.id,newDevice),0)
    assert.equal((await cursor(deviceA,client.id)).id,client.firstMessageId)
  })
  for (const [name, change, code] of [
    ['AAL1',()=>f.setClaims({...f.claims,aal:'aal1'}),'42501'],
    ['wrong actor',()=>f.setClaims({...f.claims,sub:other}),'42501'],
    ['missing membership',()=>db.query('delete from workspace_memberships where workspace_id=$1 and user_id=$2',[w,me]),'42501'],
    ['expired session',()=>db.query("update auth.sessions set not_after='2000-01-01' where id=$1",[sessionA]),'42501'],
    ['unbound installation',()=>db.query('delete from account_session_devices where session_id=$1',[sessionA]),'P0002'],
  ]) await check(`identity gate: ${name}`,async()=>{await change();await denied(()=>batch(native),code)})
  await check('one requested denied conversation rejects the entire preview batch',async()=>{
    await db.query('delete from workspace_native_conversation_participants where conversation_id=$1',[conversations[3].id])
    await denied(()=>f.batch({kind:'native',conversationIds:[native.id,conversations[3].id]}),'42501')
  })
  await check('cross-workspace conversation cannot enter preview batch',async()=>{
    await db.query('update workspace_native_conversations set workspace_id=$1 where id=$2',[id(99),native.id])
    await denied(()=>batch(native),'42501')
  })
} finally {
  await f.close()
  report.passed=report.cases.filter(c=>c.passed).length
  report.total=report.cases.length
  await writeFile(output,JSON.stringify(report,null,2))
}
console.log(JSON.stringify({passed:report.passed,total:report.total,output}))
