// Optional native PostgreSQL rehearsal. Creates its own private socket-only
// cluster; never accepts a database URL or connects to an existing database.
// BE_RECORDS_PG_BIN=/reviewed/postgresql/bin node scripts/validate-communication-references-postgres.mjs
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildCommunicationReferencesOnlineRelease } from './build-communication-references-online-release.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const bin = process.env.BE_RECORDS_PG_BIN
assert.ok(bin && path.isAbsolute(bin), 'Set BE_RECORDS_PG_BIN to a reviewed PostgreSQL binary directory')
const evidencePath = process.env.BE_REFERENCES_PG_EVIDENCE
const childEnv = { PATH: '/usr/bin:/bin', LC_ALL: 'C', TZ: 'UTC' }
const temporary = await mkdtemp(path.join(tmpdir(), 'be-comms-reference-pg-'))
const data = path.join(temporary, 'data'), socket = path.join(temporary, 'socket')
await mkdir(socket, { mode: 0o700 })
const port = '55481' // Private UNIX socket; TCP is disabled.
const sessions = new Set(), results = [], observations = [], sources = {}
let serial = 0, startAttempted = false, serverStarted = false, outcome = 'failed'
const literal = value => `'${String(value).replaceAll("'", "''")}'`
const hash = value => createHash('sha256').update(value).digest('hex')
function pass(name, extra = {}) { results.push({ name, passed: true, ...extra }); console.log(`ok ${results.length} - ${name}`) }
async function source(relative) {
    const value = await readFile(path.join(root, relative), 'utf8')
    sources[relative] = hash(value)
    return value
}

class Session {
    constructor(name) {
        this.name = `${name}_${++serial}`; this.buffer = ''; this.errors = ''; this.pending = null
        this.child = spawn(path.join(bin, 'psql'), ['-X', '--no-password', '-qAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', '-h', socket, '-p', port, '-U', 'fixture_owner', '-d', 'postgres'], { env: childEnv, stdio: ['pipe', 'pipe', 'pipe'] })
        sessions.add(this)
        this.child.stdout.on('data', chunk => {
            this.buffer += chunk.toString()
            while (this.buffer.includes('\n')) {
                const end = this.buffer.indexOf('\n'), line = this.buffer.slice(0, end).replace(/\r$/, '')
                this.buffer = this.buffer.slice(end + 1)
                if (this.pending && line === this.pending.marker) {
                    const pending = this.pending; this.pending = null; clearTimeout(pending.timer); pending.resolve(pending.lines)
                } else if (this.pending && line.trim()) this.pending.lines.push(line)
            }
        })
        this.child.stderr.on('data', chunk => { this.errors += chunk.toString() })
        this.child.on('error', error => this.reject(error))
        this.child.on('exit', (code, signal) => {
            this.exited = true
            this.reject(Object.assign(new Error(`psql ${this.name} exited ${code ?? signal}: ${this.errors}`), { sqlstate: this.errors.match(/ERROR:\s+([A-Z0-9]{5}):/)?.[1] }))
            sessions.delete(this)
        })
    }
    reject(error) { if (this.pending) { clearTimeout(this.pending.timer); this.pending.reject(error); this.pending = null } }
    query(sql) {
        assert.equal(this.pending, null, `Overlapping query on ${this.name}`)
        assert.ok(!this.exited, `Closed session ${this.name}`)
        return new Promise((resolve, reject) => {
            const marker = `BE_END_${this.name}_${++serial}`
            const timer = setTimeout(() => { this.reject(new Error(`Bounded query timeout: ${this.name}`)); this.child.kill('SIGTERM') }, 20000)
            this.pending = { marker, resolve, reject, timer, lines: [] }
            this.child.stdin.write(`${sql}\n;\n\\echo ${marker}\n`)
        })
    }
    async json(sql) {
        const rows = await this.query(sql)
        assert.equal(rows.length, 1, `Expected one JSON row: ${this.name}`)
        return JSON.parse(rows[0])
    }
    async close() {
        if (this.exited) return
        this.child.stdin.end('\\q\n')
        await new Promise(resolve => { this.child.once('exit', resolve); setTimeout(() => { if (!this.exited) this.child.kill('SIGTERM'); resolve() }, 500).unref() })
    }
}
async function connect(name) {
    const session = new Session(name)
    await session.query(`set application_name=${literal(`be_reference_${session.name}`)}; set statement_timeout='12s'; set lock_timeout='8s'; set idle_in_transaction_session_timeout='18s'`)
    session.pid = await session.json('select to_json(pg_backend_pid())')
    return session
}
let admin
async function rejectsSql(name, sql, pattern, code) {
    const session = await connect('denied')
    try {
        await assert.rejects(session.query(sql), error => (!code || error.sqlstate === code) && (!pattern || pattern.test(error.message)))
        pass(name, code ? { sqlstate: code } : {})
    } finally { await session.close() }
}
async function waitBlocked(session, locktype) {
    const deadline = Date.now() + 4000
    while (Date.now() < deadline) {
        assert.ok(!session.exited, `Session ${session.name} exited before expected lock wait: ${session.errors}`)
        const locks = await admin.json(`select coalesce(jsonb_agg(jsonb_build_object('locktype',locktype,'mode',mode)),'[]'::jsonb) from pg_locks where pid=${session.pid} and not granted`)
        if (locks.some(lock => lock.locktype === locktype)) return locks
        await new Promise(resolve => setTimeout(resolve, 10))
    }
    throw new Error(`Session ${session.name} did not reach the expected ${locktype} lock wait`)
}
async function indexState(name) {
    return admin.json(`select coalesce((select jsonb_build_object('valid',i.indisvalid,'ready',i.indisready,'live',i.indislive) from pg_index i where i.indexrelid=to_regclass(${literal(`public.${name}`)})),'null'::jsonb)`)
}

try {
    await source('scripts/validate-communication-references-postgres.mjs')
    await source('scripts/build-communication-references-online-release.mjs')
    const release = await buildCommunicationReferencesOnlineRelease()
    const { manifest, files } = release
    observations.push({ name: 'exact generated online release', manifest })
    await source('supabase/migrations/20261003120000_communication_record_references.sql')
    assert.equal(manifest.indexes.length, 5)
    for (const index of manifest.indexes) {
        const sql = files[index.createFile]
        assert.equal(typeof sql, 'string')
        // A single statement must reach PostgreSQL as its own command. Settings
        // and guards are deliberately sent separately from concurrent creation.
        const stripped = sql.replace(/^\s*--.*$/gm, '').trim()
        assert.match(stripped, /^create index concurrently\s/i)
        assert.equal((stripped.match(/;/g) ?? []).length, 1)
        assert.ok(!/\bif not exists\b/i.test(stripped))
    }
    execFileSync(path.join(bin, 'initdb'), ['-D', data, '--username=fixture_owner', '--auth-local=trust', '--auth-host=reject', '--encoding=UTF8', '--locale=C'], { env: childEnv, stdio: 'pipe', timeout: 20000 })
    startAttempted = true
    execFileSync(path.join(bin, 'pg_ctl'), ['-D', data, '-l', path.join(temporary, 'server.log'), '-o', `-k ${socket} -p ${port} -c listen_addresses='' -c unix_socket_permissions=0700 -c max_connections=12 -c shared_buffers=16MB`, '-w', '-t', '15', 'start'], { env: childEnv, stdio: 'pipe', timeout: 20000 })
    serverStarted = true; admin = await connect('admin')
    observations.push({ name: 'runtime', version: await admin.json('select to_json(version())'), tcpListeners: await admin.json("select to_json(current_setting('listen_addresses'))"), fixture: 'fresh private UNIX socket cluster, synthetic data only' })
    await admin.query(`
        create schema auth;
        create role anon; create role authenticated; create role service_role bypassrls;
        create function auth.uid() returns uuid language sql stable as $$select null::uuid$$;
        create table public.work_items(id uuid primary key,workspace_id uuid not null,title text,metadata jsonb not null default '{}',visibility text not null default 'workspace',updated_at timestamptz not null default now());
        create table public.assets(id uuid primary key,workspace_id uuid not null,title text,metadata jsonb not null default '{}',updated_at timestamptz not null default now());
        create table public.relationships(id uuid primary key,workspace_id uuid not null,primary_person_name text,business_name text,status text not null default 'active',updated_at timestamptz not null default now());
        create index work_items_active_library_idx on public.work_items(workspace_id,updated_at desc) where visibility='workspace' and metadata->>'archived_at' is null;
        create index assets_attachment_choices_idx on public.assets(workspace_id,updated_at desc,id desc) where metadata->>'archived_at' is null;
        insert into public.work_items(id,workspace_id,title) select ('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'10000000-0000-4000-8000-000000000001','Synthetic '||n from generate_series(1,1000)n;
        insert into public.assets(id,workspace_id,title) select id,workspace_id,title from public.work_items;
        insert into public.relationships(id,workspace_id,primary_person_name,business_name) select id,workspace_id,title,title from public.work_items;
        set check_function_bodies=off;
    `)
    // Exact canonical bodies establish the installer's source fingerprint guard.
    // They are not executed by this minimal fixture; the PGlite policy suite
    // separately exercises authorization against its representative schema.
    const migrations = []
    for (const name of (await readdir(path.join(root, 'supabase/migrations'))).filter(name => name.endsWith('.sql')).sort()) migrations.push(await readFile(path.join(root, 'supabase/migrations', name), 'utf8'))
    const definitions = new Map()
    for (const name of ['native_conversation_can_read', 'current_session_is_aal2', 'workspace_user_can_access_work_item', 'workspace_user_can_access_relationship', 'workspace_user_can_access_asset']) {
        const pattern = new RegExp(`create(?: or replace)? function public\\.${name}\\([\\s\\S]*?\\$\\$;`, 'gi')
        const sql = migrations.flatMap(value => [...value.matchAll(pattern)].map(match => match[0])).at(-1)
        assert.ok(sql); definitions.set(name, sql); await admin.query(sql)
    }
    await admin.query(files[manifest.preflightFile])
    pass('fresh isolated PostgreSQL loads synthetic tables and exact canonical policy fingerprints')

    const first = manifest.indexes[0]
    assert.equal(first.table, 'work_items')
    const writer = await connect('held_writer'), ddl = await connect('ddl')
    await writer.query("begin; update public.work_items set title=title||' held' where id='00000000-0000-4000-8000-000000000001'")
    const ordinary = ddl.query('create index fixture_ordinary_write_block_idx on public.work_items(title)')
    ordinary.catch(() => {})
    const ordinaryLocks = await waitBlocked(ddl, 'relation')
    await rejectsSql('negative control: ordinary CREATE INDEX queues a lock that blocks a second writer', "set lock_timeout='500ms'; update public.work_items set title=title||' other' where id='00000000-0000-4000-8000-000000000002'", /lock timeout/, '55P03')
    await writer.query('commit'); await ordinary
    await admin.query('drop index public.fixture_ordinary_write_block_idx')
    observations.push({ name: 'ordinary index lock wait negative control', locks: ordinaryLocks })

    await rejectsSql('concurrent DDL rejects transaction-wrapped execution', `begin; ${files[first.createFile]}`, /transaction block/, '25001')
    await admin.query(`create index ${first.name} on public.work_items(id)`)
    await rejectsSql('same-name wrong-definition index is rejected by pre-create guard', files[first.guardFile], /index|definition/i)
    await rejectsSql('same-name wrong-definition index is rejected by verifier', files[first.verifyFile], /index|definition/i)
    await admin.query(`drop index concurrently public.${first.name}`)

    await writer.query("begin; update public.work_items set title=title||' held' where id='00000000-0000-4000-8000-000000000001'")
    const cancelled = await connect('cancelled_build')
    const cancelledResult = assert.rejects(cancelled.query(files[first.createFile]), error => error.sqlstate === '57014')
    await waitBlocked(cancelled, 'virtualxid')
    assert.equal(await admin.json(`select to_json(pg_cancel_backend(${cancelled.pid}))`), true)
    await cancelledResult
    await writer.query('commit')
    const invalid = await indexState(first.name)
    assert.ok(invalid); assert.equal(invalid.valid, false)
    pass('cancelling a waiting concurrent build leaves an observable invalid index', { state: invalid })
    await rejectsSql('incomplete concurrent index is rejected by pre-create guard', files[first.guardFile], /index|invalid/i)
    await rejectsSql('incomplete concurrent index is rejected by verifier', files[first.verifyFile], /index|invalid/i)
    await rejectsSql('blind concurrent retry cannot conceal an invalid index', files[first.createFile], /already exists/, '42P07')
    // Explicit recovery is limited to the cancelled synthetic fixture object.
    // The generated production pack must never remove existing objects itself.
    await admin.query(`drop index concurrently public.${first.name}`)
    assert.equal(await indexState(first.name), null)
    await admin.query(files[first.guardFile])

    await writer.query("begin; update public.work_items set title=title||' held' where id='00000000-0000-4000-8000-000000000001'")
    const concurrent = ddl.query(files[first.createFile]); concurrent.catch(() => {})
    const concurrentLocks = await waitBlocked(ddl, 'virtualxid')
    const independent = await connect('independent_writer')
    await independent.query("set lock_timeout='500ms'; update public.work_items set title=title||' other' where id='00000000-0000-4000-8000-000000000002'")
    assert.ok(ddl.pending, 'Concurrent build must still wait while the independent writer commits')
    await writer.query('commit'); await concurrent
    await admin.query(files[first.verifyFile])
    assert.deepEqual(await indexState(first.name), { valid: true, ready: true, live: true })
    observations.push({ name: 'concurrent index lock wait', locks: concurrentLocks })
    pass('standalone concurrent creation permits a second writer while awaiting an earlier writer')

    await rejectsSql('RPC installation refuses an incomplete set of required indexes', files[manifest.rpcFile], /index/i)
    for (const index of manifest.indexes.slice(1)) {
        await admin.query(files[index.guardFile])
        await ddl.query(files[index.createFile])
        await admin.query(files[index.verifyFile])
        assert.deepEqual(await indexState(index.name), { valid: true, ready: true, live: true })
    }
    pass('all five exact standalone index files install with valid, ready and live catalog states')
    const existingCheck = await admin.query(files[first.guardFile])
    assert.ok(existingCheck.some(line => line.includes('verified: skip create')))
    await rejectsSql('the standalone CREATE still refuses to recreate a verified index', files[first.createFile], /already exists/, '42P07')
    await admin.query("create or replace function public.native_conversation_can_read(target_conversation uuid,target_user uuid default auth.uid()) returns boolean language sql stable security definer set search_path=public as $$select true$$")
    await rejectsSql('RPC guard rejects canonical policy drift after indexes exist', files[manifest.rpcFile], /Canonical policy differs/)
    await admin.query(definitions.get('native_conversation_can_read'))
    const rpcMissing = () => admin.json("select to_json(to_regprocedure('public.read_communication_references(text,uuid,uuid,text,jsonb)') is null)")
    assert.equal(await rpcMissing(), true)
    await rejectsSql('RPC source corruption fails checksum before function creation', files[manifest.rpcFile].replace('create function public.read_communication_references(', '-- Altered source\ncreate function public.read_communication_references('), /RPC source failed checksum/)
    assert.equal(await rpcMissing(), true)
    await ddl.query(files[manifest.rpcFile])
    const rpc = await admin.json("select jsonb_build_object('body',md5(prosrc),'securityDefiner',prosecdef,'config',proconfig,'service',has_function_privilege('service_role',oid,'execute'),'authenticated',has_function_privilege('authenticated',oid,'execute'),'anon',has_function_privilege('anon',oid,'execute')) from pg_proc where oid=to_regprocedure('public.read_communication_references(text,uuid,uuid,text,jsonb)')")
    assert.equal(rpc.body, manifest.rpcBodyMd5); assert.equal(rpc.securityDefiner, true)
    assert.equal(rpc.service, true); assert.equal(rpc.authenticated, false); assert.equal(rpc.anon, false)
    assert.ok(rpc.config.includes('statement_timeout=3s')); assert.ok(rpc.config.includes('plan_cache_mode=force_custom_plan'))
    pass('RPC installs only after all exact indexes and retains exact body and server-only grants')
    const originalOid = await admin.json("select to_json('public.read_communication_references(text,uuid,uuid,text,jsonb)'::regprocedure::oid)")
    await ddl.query(files[manifest.rpcFile])
    assert.equal(await admin.json("select to_json('public.read_communication_references(text,uuid,uuid,text,jsonb)'::regprocedure::oid)"), originalOid)
    await admin.query(files[manifest.postflightFile])
    pass('exact installed RPC retry verifies without replacement and independent postflight succeeds')
    await admin.query('grant execute on function public.read_communication_references(text,uuid,uuid,text,jsonb) to authenticated')
    await rejectsSql('existing RPC permission drift fails closed instead of being silently repaired', files[manifest.rpcFile], /definition, settings or grants differ/)
    await admin.query('revoke execute on function public.read_communication_references(text,uuid,uuid,text,jsonb) from authenticated')
    await admin.query(files[manifest.postflightFile])
    observations.push({ name: 'unverified boundaries', items: ['Synthetic schema and lock schedules only; not production index-build duration or resource pressure', 'Canonical policy functions are fingerprinted here; authorization execution is covered separately', 'No authenticated UI, network transaction settings, or physical-device claim'] })
    outcome = 'passed'
} finally {
    await Promise.allSettled([...sessions].map(session => session.close()))
    let stopped = !startAttempted
    if (startAttempted) {
        try { execFileSync(path.join(bin, 'pg_ctl'), ['-D', data, '-m', 'immediate', '-w', '-t', '10', 'stop'], { env: childEnv, stdio: 'pipe', timeout: 15000 }); stopped = true }
        catch (error) {
            try { execFileSync(path.join(bin, 'pg_ctl'), ['-D', data, 'status'], { env: childEnv, stdio: 'pipe', timeout: 5000 }) }
            catch (statusError) { if (statusError.status === 3) stopped = true }
            if (!stopped) observations.push({ name: 'cleanup error', error: String(error), retainedTemporaryDirectory: temporary })
        }
    }
    const report = { outcome, passed: results.length, productionCalls: 0, externalDeliveryCalls: 0, serverStarted, serverStopped: stopped, sources, results, observations }
    if (evidencePath) await writeFile(evidencePath, `${JSON.stringify(report, null, 2)}\n`)
    console.log(JSON.stringify({ outcome, passed: results.length, productionCalls: 0, serverStopped: stopped, evidencePath: evidencePath ?? null }))
    if (stopped) await rm(temporary, { recursive: true, force: true })
}
