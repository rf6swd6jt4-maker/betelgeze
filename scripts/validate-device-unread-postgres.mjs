// Fresh private socket-only PostgreSQL; no existing database URL is accepted.
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { deviceUnreadFixtureSql, deviceUnreadIds as ids, id } from './device-unread-sql-fixture.mjs'
const bin = process.env.BE_RECORDS_PG_BIN
assert.ok(bin && path.isAbsolute(bin), 'Set BE_RECORDS_PG_BIN to the isolated PostgreSQL binary directory')
const temp = await mkdtemp(path.join(tmpdir(), 'be-device-read-pg-')), socket = path.join(temp, 'socket'), data = path.join(temp, 'data')
const port = '55483', environment = { PATH: '/usr/bin:/bin', LC_ALL: 'C', TZ: 'UTC' }, sessions = new Set(), results = []
await mkdir(socket, { mode: 0o700 })
let started = false, serial = 0
const literal = value => `'${String(value).replaceAll("'", "''")}'`
class Session {
    constructor(name) {
        this.name = `${name}_${++serial}`; this.buffer = ''; this.errors = ''; this.pending = null
        this.child = spawn(path.join(bin, 'psql'), ['-X', '--no-password', '-qAt', '-v', 'ON_ERROR_STOP=1', '-h', socket, '-p', port, '-U', 'fixture_owner', '-d', 'postgres'], { env: environment, stdio: ['pipe', 'pipe', 'pipe'] })
        sessions.add(this)
        this.child.stdout.on('data', chunk => {
            this.buffer += chunk.toString()
            while (this.buffer.includes('\n')) {
                const end = this.buffer.indexOf('\n'), line = this.buffer.slice(0, end).replace(/\r$/, '')
                this.buffer = this.buffer.slice(end + 1)
                if (this.pending && line === this.pending.marker) {
                    const next = this.pending; this.pending = null; clearTimeout(next.timer); next.resolve(next.lines)
                } else if (this.pending && line.trim()) this.pending.lines.push(line)
            }
        })
        this.child.stderr.on('data', chunk => { this.errors += chunk.toString() })
        this.child.on('error', error => this.reject(error))
        this.child.on('exit', code => { this.exited = true; this.reject(Error(`psql exited ${code}: ${this.errors}`)); sessions.delete(this) })
    }
    reject(error) { if (this.pending) { clearTimeout(this.pending.timer); this.pending.reject(error); this.pending = null } }
    query(sql) {
        assert.equal(this.pending, null)
        return new Promise((resolve, reject) => {
            const marker = `BE_DEVICE_END_${++serial}`
            const timer = setTimeout(() => { this.reject(Error(`Query deadline ${this.name}`)); this.child.kill('SIGTERM') }, 15000)
            this.pending = { marker, timer, resolve, reject, lines: [] }
            this.child.stdin.write(`${sql}\n;\n\\echo ${marker}\n`)
        })
    }
    async json(sql) { const rows = await this.query(sql); assert.equal(rows.length, 1); return JSON.parse(rows[0]) }
    close() { this.child.stdin.end('\\q\n') }
}
async function connect(name, sessionId) {
    const session = new Session(name)
    await session.query(`set application_name=${literal(session.name)}; set statement_timeout='10s'; set lock_timeout='8s'; set idle_in_transaction_session_timeout='12s'`)
    if (sessionId) await session.query(`set request.jwt.claims=${literal(JSON.stringify({ sub: ids.me, session_id: sessionId, role: 'authenticated', aal: 'aal2' }))}`)
    session.pid = await session.json('select to_json(pg_backend_pid())')
    return session
}
let admin
async function blocked(session) {
    const end = Date.now() + 4000
    while (Date.now() < end) {
        if (await admin.json(`select to_json(exists(select 1 from pg_locks where pid=${session.pid} and not granted))`)) return
        await new Promise(resolve => setTimeout(resolve, 10))
    }
    throw Error(`Expected concurrent lock wait for ${session.name}`)
}
function passed(name) { results.push(name); console.log(`ok ${results.length} - ${name}`) }
const summary = device => `select communication_device_unread_summary('${ids.w}','${device}')`
const read = (device, kind, message) => `select advance_communication_device_read('${ids.w}','${device}','${kind}','${kind === 'client' ? ids.client : ids.native}','${message}')`
try {
    execFileSync(path.join(bin, 'initdb'), ['-D', data, '--username=fixture_owner', '--auth-local=trust', '--auth-host=reject', '--encoding=UTF8', '--locale=C'], { env: environment, stdio: 'pipe', timeout: 20000 })
    execFileSync(path.join(bin, 'pg_ctl'), ['-D', data, '-l', path.join(temp, 'server.log'), '-o', `-k ${socket} -p ${port} -c listen_addresses='' -c unix_socket_permissions=0700 -c max_connections=12`, '-w', '-t', '15', 'start'], { env: environment, stdio: 'pipe', timeout: 20000 })
    started = true; admin = await connect('admin')
    await admin.query(await deviceUnreadFixtureSql())
    const a = await connect('a', ids.sessionA), sibling = await connect('sibling', ids.sessionA), b = await connect('b', ids.sessionB)
    await admin.query(`insert into client_messages values('${id(101)}','${ids.w}','${ids.client}','inbound','2026-10-09 10:00:01.123456Z'),('${id(102)}','${ids.w}','${ids.client}','inbound','2026-10-09 10:00:02.123456Z'); insert into workspace_native_messages values('${id(201)}','${ids.w}','${ids.native}','${ids.other}','2026-10-09 10:00:01.123456Z'),('${id(202)}','${ids.w}','${ids.native}','${ids.other}','2026-10-09 10:00:02.123456Z')`)
    await a.query('begin')
    const first = await a.json(summary(ids.deviceA))
    assert.equal(first.conversations.length, 2)
    const siblingInitialization = sibling.json(read(ids.deviceA, 'client', id(101)))
    await blocked(sibling)
    await a.query('commit')
    const initialRead = await siblingInitialization
    assert.equal(initialRead.deviceCursor.lastReadMessageId, id(101))
    assert.equal(await admin.json(`select to_json(count(*)) from communication_device_read_scopes where device_id='${ids.deviceA}'`), 1)
    passed('simultaneous first summary and read serialize initialization without duplicate or empty seeds')
    const sleeping = await b.json(summary(ids.deviceB))
    assert.equal(sleeping.readCursors.find(row => row.kind === 'client').lastReadMessageId, id(100))
    passed('sleeping known device starts from frozen cutover despite A advancing account receipt')
    for (const [kind, older, newer] of [['native', id(201), id(202)], ['client', id(101), id(102)]]) {
        await a.query('begin')
        const aRead = await a.json(read(ids.deviceA, kind, older))
        const concurrentB = b.json(read(ids.deviceB, kind, newer))
        await blocked(b)
        await a.query('commit')
        const bRead = await concurrentB
        assert.equal(aRead.deviceCursor.lastReadMessageId, older)
        assert.equal(bRead.deviceCursor.lastReadMessageId, newer)
        const after = await a.json(summary(ids.deviceA))
        assert.equal(after.conversations.find(row => row.kind === kind).count, 1)
        const late = await a.json(read(ids.deviceA, kind, older))
        assert.equal(late.deviceCursor.lastReadMessageId, older)
        assert.equal(late.cursor.lastReadMessageId, newer)
        passed(`${kind}: concurrent devices retain independent cursors and monotonically advance account receipt`)
    }
    await a.query('begin')
    await a.json(read(ids.deviceA, 'native', id(202)))
    const lateSibling = sibling.json(read(ids.deviceA, 'native', id(201)))
    await blocked(sibling)
    await a.query('commit')
    assert.equal((await lateSibling).deviceCursor.lastReadMessageId, id(202))
    passed('late read from same-installation sibling cannot move device cursor backwards')
    await admin.query(`insert into auth.sessions values('${ids.newSession}','${ids.me}',null); insert into account_session_devices values('${ids.newSession}','${ids.me}','${ids.newDevice}')`)
    const fresh = await connect('fresh', ids.newSession)
    await fresh.query('begin')
    await fresh.json(summary(ids.newDevice))
    await fresh.query('rollback')
    assert.equal(await admin.json(`select to_json(count(*)) from communication_device_read_scopes where device_id='${ids.newDevice}'`), 0)
    assert.equal(await admin.json(`select to_json(count(*)) from communication_device_read_cursors where device_id='${ids.newDevice}'`), 0)
    passed('rolled-back initialization preserves atomic absence of scope and device cursors')
    const newSummary = await fresh.json(summary(ids.newDevice))
    assert.deepEqual(newSummary.conversations, [])
    passed('new installation starts from current account position once')
    const report = { passed: true, cases: results, runtime: await admin.json('select to_json(version())'), externalNetwork: false }
    if (process.env.BE_DEVICE_READ_PG_EVIDENCE) await writeFile(process.env.BE_DEVICE_READ_PG_EVIDENCE, JSON.stringify(report, null, 2))
    console.log(JSON.stringify(report))
} finally {
    for (const session of sessions) session.close()
    if (started) execFileSync(path.join(bin, 'pg_ctl'), ['-D', data, '-m', 'immediate', '-w', 'stop'], { env: environment, stdio: 'pipe', timeout: 15000 })
    await rm(temp, { recursive: true, force: true })
}
