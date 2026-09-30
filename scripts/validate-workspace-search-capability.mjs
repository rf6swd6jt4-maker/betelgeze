import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PGlite, repositoryRoot } from './pglite-fixture.mjs'

// Isolated PostgreSQL only. The historical speed fixture remains immutable.
export const capabilityMigration = 'supabase/migrations/20260930140000_workspace_search_capability.sql'
export const id = value => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`
export const workspace = id(1), foreignWorkspace = id(2)
export const users = { ordinary: id(10), seller: id(11), manager: id(12), optional: id(13), partial: id(14), owner: id(15), admin: id(16), other: id(17) }
const read = path => readFile(`${repositoryRoot}${path}`, 'utf8')

export async function createCapabilityFixture({ candidateSql, installCandidate = true } = {}) {
    const db = new PGlite()
    const query = (sql, values = []) => db.query(sql, values)
    try {
        const historical = await read('scripts/validate-workspace-search-retrieval.mjs')
        const schema = historical.match(/try\s*\{\s*await db\.exec\(`([\s\S]*?)`\)/)?.[1]
        assert.ok(schema && !schema.includes('${'), 'historical fixture schema must remain a row-free literal')
        const indexList = historical.match(/const existingIndexes = \[([^\]]+)\]/)?.[1]
        assert.ok(indexList, 'historical index list must remain explicit')
        const sources = []
        for (const name of (await readdir(`${repositoryRoot}supabase/migrations`)).filter(name => name.endsWith('.sql')).sort()) sources.push({ name, sql: await read(`supabase/migrations/${name}`) })
        const latest = name => {
            const pattern = new RegExp(`create(?: or replace)? function public\\.${name}\\([\\s\\S]*?\\$\\$;`, 'gi')
            const found = sources.flatMap(source => [...source.sql.matchAll(pattern)].map(match => ({ name, source: source.name, sql: match[0] }))).at(-1)
            assert.ok(found, `canonical policy ${name}`)
            return found
        }
        await db.exec(schema)
        await db.exec(`
            create or replace function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
            create function auth.role() returns text language sql as $$ select coalesce(current_setting('request.jwt.claim.role',true),'') $$;
            create function auth.jwt() returns jsonb language sql as $$ select jsonb_build_object('aal',current_setting('request.jwt.claim.aal',true),'role',auth.role()) $$;
            set request.jwt.claim.role='service_role'; set request.jwt.claim.aal='aal2';
            create table user_profiles(user_id uuid primary key,mfa_reenrollment_required boolean default false);
            alter table relationship_onboarding_sessions add status text default 'active',add archived_at timestamptz,add created_at timestamptz default now(),add updated_at timestamptz default now(),add session_token text,add unique(workspace_id,id);
            alter table relationship_onboarding_session_modules add module_id uuid,add sort_order integer,add unique(session_id,module_id),add unique(session_id,sort_order);
            alter table work_items add due_date date,add due_time time,add planned_start_date date,add completion_mode text default 'manual',add workflow_action text;
            alter table work_items alter workflow_role set default 'task';
            alter table assets add metadata jsonb default '{}'::jsonb;
            alter table work_item_relationships add created_at timestamptz default now();
            create table workspace_teams(id uuid primary key,workspace_id uuid,relationship_id uuid,kind text,name text,archived_at timestamptz,unique(workspace_id,id));
            create table workspace_team_members(workspace_id uuid,team_id uuid,user_id uuid,primary key(team_id,user_id));
            create table workspace_native_conversations(id uuid primary key,workspace_id uuid,team_id uuid,kind text,archived_at timestamptz,unique(workspace_id,id));
            create table workspace_native_conversation_participants(workspace_id uuid,conversation_id uuid,user_id uuid,primary key(conversation_id,user_id));
        `)
        const policyNames = ['workspace_role_for_user', 'workspace_user_can_sell', 'workspace_user_has_service', 'workspace_user_can_access_relationship', 'workspace_user_fully_covers_relationship', 'workspace_user_can_access_session_module', 'workspace_user_can_access_session_step', 'workspace_user_can_access_work_item', 'client_conversation_can_access', 'workspace_delivery_access_scope', 'current_session_is_aal2', 'native_conversation_can_read', 'workspace_user_can_access_full_onboarding_session', 'queue_work_open']
        const policies = policyNames.map(latest)
        for (const policy of policies) await db.exec(policy.sql)
        const indexNames = [...indexList.matchAll(/'([a-z_]+)'/g)].map(match => match[1]).concat(['relationship_onboarding_sessions_relationship_idx', 'workspace_teams_relationship_unique', 'workspace_native_conversations_team_unique', 'work_item_relationships_relationship_idx'])
        for (const name of indexNames) {
            const pattern = new RegExp(`create(?: unique)? index(?: if not exists)? ${name}\\s[\\s\\S]*?;`, 'i')
            const sql = sources.map(source => source.sql.match(pattern)?.[0]).find(Boolean)
            assert.ok(sql, `existing source index ${name}`)
            await db.exec(sql)
        }
        await db.exec(await read('supabase/migrations/20260929120000_search_contact_authorization.sql'))
        await db.exec(await read('supabase/migrations/20260930120000_workspace_search_retrieval.sql'))
        const install = async sql => db.exec(sql ?? await read(capabilityMigration))
        if (installCandidate) await install(candidateSql)
        const search = async (actor, term = 'Jason', slug = 'synthetic') => (await query('select public.search_workspace_records($1,$2,$3) as value', [slug, actor, term])).rows[0].value
        const withRole = async (role, operation) => {
            assert.ok(['service_role', 'authenticated', 'anon'].includes(role))
            await db.exec(`set role ${role}`)
            try { return await operation() } finally { await db.exec('reset role') }
        }
        return { db, query, search, withRole, install, policies, indexNames, id, workspace, foreignWorkspace, users }
    } catch (error) { await db.close(); throw error }
}

const fields = {
    relationships: ['id', 'primary_person_name', 'business_name', 'primary_email', 'primary_phone', 'status', 'match_rank', 'match_field'],
    work_items: ['id', 'title', 'description', 'kind', 'visibility', 'archived'],
    okrs: ['id', 'objective', 'objective_type', 'description', 'status', 'period_end'],
    key_results: ['id', 'name', 'description'], admin_activity: ['id', 'summary', 'category', 'level'],
    modules: ['id', 'name', 'description', 'status'], services: ['id', 'name', 'description', 'state'],
    assets: ['id', 'title', 'archived'], notes: ['id', 'name', 'description'], channels: ['relationship_id', 'external_address', 'provider'],
    activities: ['id', 'relationship_id', 'activity_text', 'activity_type'],
    related: ['kind', 'id', 'relationship_id', 'relationship_name', 'title', 'status', 'session_id', 'due_date', 'visibility'],
}
export function assertCapabilityProjection(snapshot) {
    assert.equal(snapshot.schema_version, 2)
    assert.deepEqual(snapshot.clients, [], 'empty clients compatibility field keeps the deployed parser valid during database-first rollout')
    assert.deepEqual(Object.keys(snapshot).sort(), ['schema_version', 'workspace', 'role', 'can_sell', 'capabilities', 'clients', ...Object.keys(fields)].sort(), 'no unreviewed top-level payload')
    if (snapshot.role === 'staff') for (const category of Object.keys(fields).filter(name => !['relationships', 'work_items', 'channels', 'related'].includes(name))) assert.deepEqual(snapshot[category], [], `staff cannot receive ${category}`)
    for (const [category, projection] of Object.entries(fields)) {
        assert.ok(Array.isArray(snapshot[category]), category)
        const limit = { relationships: 8, channels: 4, activities: 4, related: 10 }[category] ?? 6
        assert.ok(snapshot[category].length <= limit, `${category} stays bounded`)
        for (const row of snapshot[category]) {
            assert.deepEqual(Object.keys(row).sort(), [...projection].sort(), `${category} exports only reviewed fields`)
            if (category === 'work_items' || category === 'assets') assert.equal(typeof row.archived, 'boolean')
        }
    }
    const counts = new Map(), relatedSeeds = new Set()
    const seeds = new Map(snapshot.relationships.filter(row => row.status !== 'archived' && row.match_rank <= 3).map(row => [row.id, row]))
    for (const row of snapshot.related) {
        assert.ok(seeds.has(row.relationship_id), 'related seed is an emitted permitted strong canonical match')
        assert.equal(row.relationship_name, seeds.get(row.relationship_id).primary_person_name, 'related name uses the exact permitted primary name')
        const key = `${row.relationship_id}:${row.kind}`
        counts.set(key, (counts.get(key) ?? 0) + 1)
        assert.ok(counts.get(key) <= (row.kind === 'work_item' ? 2 : 1), 'per-seed related cap')
        relatedSeeds.add(row.relationship_id)
    }
    assert.ok(relatedSeeds.size <= 2)
    assert.equal(new Set(snapshot.related.map(row => `${row.kind}:${row.id}`)).size, snapshot.related.length, 'one result per destination')
    assert.ok(!JSON.stringify(snapshot).includes('BEARER-SECRET'), 'no onboarding token leaves the RPC')
}

export async function validateCapabilityCorrectness({ candidateSql } = {}) {
    const fixture = await createCapabilityFixture({ candidateSql })
    const { db, query, search, withRole } = fixture
    let passed = 0
    const report = label => { passed++; console.log(`PASS: ${label}`) }
    const run = async (actor, term = 'Jason', slug = 'synthetic') => {
        const value = await withRole('service_role', () => search(actor, term, slug))
        if (value !== null) assertCapabilityProjection(value)
        return value
    }
    const related = (snapshot, kind, relationship = id(300)) => snapshot.related.filter(row => row.kind === kind && row.relationship_id === relationship)
    const relation = async (number, name, extra = {}) => {
        const row = { id: id(number), workspace_id: workspace, primary_person_name: name, ...extra }
        const keys = Object.keys(row)
        await query(`insert into relationships(${keys.join(',')}) values(${keys.map((_, index) => `$${index + 1}`).join(',')})`, Object.values(row))
    }
    const session = async (number, relationship, extra = {}) => {
        const row = { id: id(number), workspace_id: workspace, relationship_id: id(relationship), session_token: `BEARER-SECRET-${number}`, ...extra }
        const keys = Object.keys(row)
        await query(`insert into relationship_onboarding_sessions(${keys.join(',')}) values(${keys.map((_, index) => `$${index + 1}`).join(',')})`, Object.values(row))
    }
    const work = async (number, relationship, extra = {}) => {
        const row = { id: id(number), workspace_id: workspace, title: `Task ${number}`, service_id: id(400), ...extra }
        const keys = Object.keys(row)
        await query(`insert into work_items(${keys.join(',')}) values(${keys.map((_, index) => `$${index + 1}`).join(',')})`, Object.values(row))
        await query('insert into work_item_relationships(workspace_id,work_item_id,relationship_id) values($1,$2,$3)', [workspace, id(number), id(relationship)])
    }
    try {
        await query("insert into workspaces(id,slug,name) values($1,'synthetic','Synthetic'),($2,'foreign','Foreign')", [workspace, foreignWorkspace])
        for (const [role, user] of Object.entries(users)) await query('insert into workspace_memberships values($1,$2,$3)', [workspace, user, ['owner', 'admin'].includes(role) ? role : 'staff'])
        await query("insert into workspace_memberships values($1,$2,'owner')", [foreignWorkspace, users.other])
        for (const role of ['anon', 'authenticated']) await assert.rejects(withRole(role, () => search(users.owner)), /permission denied/i, `${role} cannot invoke server-only search`)
        assert.equal(await run(null), null)
        assert.equal(await run(id(99)), null)
        assert.equal(await run(users.owner, 'Jason', 'missing'), null)
        assert.equal(await run(users.owner, 'Jason', 'foreign'), null)
        assert.deepEqual((await run(users.owner, 'x')).related, [])
        await assert.rejects(run(users.owner, 'x'.repeat(201)), /too long/i)
        report('real SQL role grants, actor/workspace denial, short-query schema and query bounds')

        await relation(100, 'Bruce', { client_id: id(200), updated_at: '2000-01-01' })
        await relation(101, 'Bruce Wayne')
        await relation(102, 'Will Bruce')
        await relation(103, 'Context only', { notes_summary: 'Bruce was mentioned here' })
        await relation(104, 'Bruce', { client_id: id(204), status: 'archived', updated_at: '2099-01-01' })
        await relation(105, 'Other person', { business_name: 'Bruce' })
        await relation(106, 'Bruce foreign', { workspace_id: foreignWorkspace })
        await query('insert into clients(id,workspace_id,name,relationship_id) values($1,$2,\'Bruce\',$3),($4,$2,\'Bruce\',$5)', [id(200), workspace, id(106), id(204), id(106)])
        const bruce = await run(users.owner, 'Bruce')
        const ranks = new Map(bruce.relationships.map(row => [row.id, row]))
        assert.equal(ranks.get(id(100)).match_rank, 1)
        assert.equal(ranks.get(id(101)).match_rank, 2)
        assert.equal(ranks.get(id(102)).match_rank, 3)
        assert.equal(ranks.get(id(103)).match_rank, 5)
        assert.equal(ranks.get(id(103)).match_field, 'notes')
        assert.equal(ranks.get(id(105)).match_field, 'business')
        assert.equal(bruce.relationships.at(-1).id, id(104), 'archived exact match follows current matches')
        assert.equal(ranks.get(id(104)).status, 'archived')
        assert.equal(bruce.relationships.filter(row => row.id === id(100)).length, 1)
        assert.ok(!ranks.has(id(200)) && !ranks.has(id(204)), 'legacy IDs do not duplicate canonical identities')
        assert.ok(!JSON.stringify(bruce).includes(id(106)), 'foreign stored references do not escape')
        assert.equal((await run(users.owner, id(100))).relationships[0].match_rank, 0)
        assert.deepEqual((await run(users.ordinary, 'Bruce')).relationships, [])
        await relation(107, 'literal %_ match')
        assert.deepEqual((await run(users.owner, '%_')).relationships.map(row => row.id), [id(107)])
        report('Bruce relevance, archive labels/order, canonical deduplication, literal matching and foreign isolation')

        await db.exec('begin')
        try {
            await db.exec(`insert into relationships(id,workspace_id,primary_person_name,updated_at) select ('31000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'${workspace}','Unrelated filler '||n,'2100-01-01' from generate_series(1,1001)n`)
            await query("update clients set name='outside-window-alias',created_at='2200-01-01' where id in($1,$2)", [id(200), id(204)])
            const alias = await run(users.owner, 'outside-window-alias')
            assert.deepEqual(alias.relationships.map(row => row.id).sort(), [id(100), id(104)])
            assert.equal(alias.relationships.find(row => row.id === id(104)).status, 'archived')
            assert.ok(alias.relationships.every(row => row.match_rank === 5 && row.match_field === 'details'))
            assert.deepEqual(alias.related, [], 'legacy-only matching does not invent strong canonical seeds')
            const unreadableAlias = await run(users.ordinary, 'outside-window-alias')
            assert.deepEqual(unreadableAlias.relationships, [], 'legacy aliases never bypass canonical staff authorization')
            assert.deepEqual(unreadableAlias.related, [])
            assert.ok(!JSON.stringify(alias).includes(id(106)))
        } finally { await db.exec('rollback') }
        report('canonical aliases outside the retained 1000-row window preserve identity/status without false related seeds')

        await relation(300, 'Jason', { business_name: 'A different business name', seller_user_id: users.seller })
        await relation(301, 'Jason', { business_name: 'Second Jason business', seller_user_id: users.other })
        await relation(302, 'Jason Zed', { seller_user_id: users.other })
        await relation(303, 'Mention only', { notes_summary: 'Jason', seller_user_id: users.other })
        await relation(304, 'Jason archived', { status: 'archived', seller_user_id: users.other })
        await query("insert into onboarding_services(id,workspace_id,internal_code) values($1,$2,'service-a'),($3,$2,'service-b')", [id(400), workspace, id(401)])
        await query('insert into relationship_services values($1,$2,$3,$4)', [workspace, id(300), id(400), users.partial])
        await query("insert into workspace_member_service_access values($1,$2,$3);", [workspace, users.partial, id(400)])
        await query("insert into workspace_service_capabilities values($1,$2,'onboarding.manage')", [workspace, id(400)])
        await query('insert into client_sales values($1,$2,$3,$4)', [id(600), workspace, users.other, users.manager])
        for (const number of [500, 501, 502, 503]) await session(number, 300, { service_scope: 'selected_services', source_sale_id: id(600), created_at: number === 500 ? '2000-01-01' : '2099-01-01' })
        await session(510, 301, { status: 'completed' })
        await query('insert into relationship_service_instances(id,workspace_id,relationship_id,service_id,assignee_user_id) values($1,$2,$3,$4,$5)', [id(800), workspace, id(300), id(400), users.partial])
        await query("insert into relationship_onboarding_session_modules(id,workspace_id,session_id,source_kind) values($1,$2,$3,'service')", [id(700), workspace, id(500)])
        await query('insert into service_instance_module_requirements values($1,$2,$3,$4,true)', [workspace, id(800), id(500), id(700)])
        assert.equal((await query('select workspace_user_can_access_full_onboarding_session($1,$2,$3) as allowed', [workspace, id(500), users.partial])).rows[0].allowed, false)
        assert.equal((await query('select workspace_user_can_access_session_module($1,$2,$3) as allowed', [workspace, id(700), users.partial])).rows[0].allowed, true)
        for (const number of [1000, 1001]) {
            await query("insert into workspace_teams values($1,$2,$3,'relationship','Team title',null)", [id(number), workspace, id(number - 700)])
            await query("insert into workspace_native_conversations(id,workspace_id,team_id,kind) values($1,$2,$3,'team')", [id(number + 100), workspace, id(number)])
        }
        await query('insert into workspace_team_members values($1,$2,$3)', [workspace, id(1000), users.partial])
        await query('insert into relationship_client_chat_members values($1,$2,$3)', [workspace, id(300), users.optional])
        await query('update relationships set client_id=$1 where id=$2', [id(1300), id(300)])
        await query("insert into clients(id,workspace_id,name,relationship_id) values($1,$2,'Jason',$3)", [id(1300), workspace, id(106)])
        await query("insert into client_communication_channels(id,workspace_id,client_id,relationship_id,external_address,provider) values($1,$2,$3,$4,'direct-contact-needle','meta_whatsapp')", [id(1400), workspace, id(1300), id(106)])
        const contactOnly = await run(users.optional, 'direct-contact-needle')
        assert.deepEqual(contactOnly.relationships, [])
        assert.deepEqual(contactOnly.related, [])
        assert.equal(contactOnly.channels.length, 1, 'existing contact search remains independently roster-authorized')
        assert.equal(contactOnly.channels[0].relationship_id, id(300), 'contact resolves canonical client association, not stored foreign reference')
        await query('delete from relationship_client_chat_members where relationship_id=$1 and user_id=$2', [id(300), users.optional])
        assert.deepEqual((await run(users.optional, 'direct-contact-needle')).channels, [])
        await query('insert into relationship_client_chat_members values($1,$2,$3)', [workspace, id(300), users.optional])
        await work(900, 300, { status: 'doing', due_date: '2099-01-01' })
        await work(901, 300, { due_date: '2000-01-01' })
        await work(902, 300, { due_date: '2099-01-02' })
        await work(903, 300, { status: 'done', due_date: '1990-01-01' })
        await work(904, 300, { metadata: { archived_at: '2020-01-01' }, due_date: '1990-01-01' })
        await work(905, 300, { native_kind: 'onboarding_step', due_date: '1990-01-01' })
        await work(906, 300, { workflow_role: 'lifecycle_stage', due_date: '1990-01-01' })
        await work(907, 300, { workflow_action: 'automatic', due_date: '1990-01-01' })
        await work(908, 300, { visibility: 'admins_only', area: 'admin', due_date: '2099-01-03' })
        await work(909, 300, { service_id: id(401), title: 'HIDDEN-WORK-TITLE', due_date: '1990-01-01' })
        // Deliberately malformed cross-workspace links make each SQL join's
        // workspace condition observable, independently of schema foreign keys.
        await query("insert into workspace_memberships values($1,$2,'owner'),($1,$3,'staff')", [foreignWorkspace, users.owner, users.partial])
        await session(599, 300, { workspace_id: foreignWorkspace, created_at: '2200-01-01' })
        await query("insert into workspace_teams values($1,$2,$3,'relationship','FOREIGN-TEAM-TITLE',null)", [id(1099), foreignWorkspace, id(300)])
        await query("insert into workspace_native_conversations(id,workspace_id,team_id,kind) values($1,$2,$3,'team')", [id(1199), foreignWorkspace, id(1099)])
        await query('insert into workspace_team_members values($1,$2,$3)', [foreignWorkspace, id(1099), users.partial])
        await work(999, 300, { workspace_id: foreignWorkspace, title: 'FOREIGN-WORK-TITLE', due_date: '1990-01-01' })
        const partial = await run(users.partial)
        assert.equal(related(partial, 'onboarding')[0].session_id, id(500), 'denied newer sessions cannot consume pre-ACL limit')
        await db.exec('begin')
        try {
            await session(505, 300, { service_scope: 'selected_services', source_sale_id: id(600), status: 'completed', created_at: '2200-01-01' })
            await query("insert into relationship_onboarding_session_modules(id,workspace_id,session_id,source_kind) values($1,$2,$3,'service')", [id(705), workspace, id(505)])
            await query('insert into service_instance_module_requirements values($1,$2,$3,$4,true)', [workspace, id(800), id(505), id(705)])
            const activeFirst = related(await run(users.partial), 'onboarding')[0]
            assert.equal(activeFirst.session_id, id(500), 'a newer permitted completed session cannot displace an older permitted active session')
            assert.equal(activeFirst.status, 'active')
        } finally { await db.exec('rollback') }
        assert.equal(related(partial, 'team_chat').length, 1)
        assert.equal(related(partial, 'client_chat').length, 0, 'Team membership does not grant client chat')
        assert.deepEqual(related(partial, 'work_item').map(row => row.id), [id(900), id(901)], 'denied work between two permitted candidates never consumes the result limit')
        await db.exec('begin')
        try {
            for (const number of [910, 911]) await work(number, 300, { service_id: id(401), status: 'doing', title: 'DENIED-BEFORE-ALLOWED', due_date: '1990-01-01' })
            const deniedFirst = await run(users.partial)
            assert.deepEqual(related(deniedFirst, 'work_item').map(row => row.id), [id(900), id(901)], 'multiple highest-ranked denied work candidates are skipped before the final two-result limit')
            assert.ok(!JSON.stringify(deniedFirst).includes('DENIED-BEFORE-ALLOWED'))
        } finally { await db.exec('rollback') }
        assert.ok(partial.related.every(row => row.relationship_name === 'Jason'))
        assert.ok(!JSON.stringify(partial).includes('HIDDEN-WORK-TITLE'))
        assert.ok(!JSON.stringify(partial).includes('FOREIGN-'), 'authorized foreign chats/work never join into the current workspace')
        assert.ok(!JSON.stringify(partial).includes(id(599)), 'foreign session never influences the local chooser')
        for (const actor of [users.owner, users.admin]) {
            const snapshot = await run(actor)
            assert.ok(!JSON.stringify(snapshot).includes('FOREIGN-') && !JSON.stringify(snapshot).includes(id(599)), 'private role cannot cross workspace joins')
            assert.equal(related(snapshot, 'onboarding')[0].session_id, null, 'multiple permitted active sessions use chooser')
            assert.equal(snapshot.related.filter(row => row.kind.endsWith('_chat')).length, 0, 'private role never bypasses chat roster')
            assert.ok(snapshot.related.every(row => ![id(302), id(303), id(304)].includes(row.relationship_id)), 'only two active strong seeds expand')
        }
        // Instrument only the two related-history predicates, then restore the
        // actual policies. This proves ambiguous input skips the expensive path;
        // an empty output alone would not establish that no history was checked.
        const measuredPolicies = fixture.policies.filter(policy => ['workspace_user_can_access_full_onboarding_session', 'queue_work_open'].includes(policy.name))
        for (const policy of measuredPolicies) {
            await db.exec(policy.sql.replace(`public.${policy.name}(`, `public.fixture_${policy.name}(`))
            await db.exec(`create sequence fixture_${policy.name}_calls minvalue 0 start 0`)
            const declaration = policy.name === 'queue_work_open' ? 'p_item public.work_items' : 'p_workspace_id uuid,p_session_id uuid,p_user_id uuid default auth.uid()'
            const arguments_ = policy.name === 'queue_work_open' ? 'p_item' : 'p_workspace_id,p_session_id,p_user_id'
            await db.exec(`create or replace function public.${policy.name}(${declaration}) returns boolean language plpgsql volatile security definer set search_path=public as $$ begin perform nextval('fixture_${policy.name}_calls'); return fixture_${policy.name}(${arguments_}); end $$`)
        }
        try {
            assert.deepEqual((await run(users.owner, 'Ja')).related, [], 'two-character queries never expand related history')
            assert.deepEqual((await run(users.owner, 'Jas')).related, [], 'three equally good prefix matches require a more selective query')
            await relation(305, 'Jason', { seller_user_id: users.other })
            assert.deepEqual((await run(users.owner)).related, [], 'more than two equally best exact matches never fan out')
            for (const policy of measuredPolicies) assert.equal((await query(`select is_called from fixture_${policy.name}_calls`)).rows[0].is_called, false, `${policy.name} not called for ambiguous/short queries`)
            await query('delete from relationships where id=$1', [id(305)])
            await run(users.owner)
            for (const policy of measuredPolicies) assert.equal((await query(`select is_called from fixture_${policy.name}_calls`)).rows[0].is_called, true, `${policy.name} counter observes selective expansion`)
        } finally {
            for (const policy of measuredPolicies) await db.exec(policy.sql.replace('create function', 'create or replace function'))
        }
        report('partial-module session access after ACL, independent chat rosters, actionable work and selective best-tier seeds')

        await session(504, 300, { service_scope: 'selected_services', source_sale_id: id(600), created_at: '2001-01-01' })
        await query("insert into relationship_onboarding_session_modules(id,workspace_id,session_id,source_kind) values($1,$2,$3,'service')", [id(704), workspace, id(504)])
        await query('insert into service_instance_module_requirements values($1,$2,$3,$4,true)', [workspace, id(800), id(504), id(704)])
        assert.equal(related(await run(users.partial), 'onboarding')[0].session_id, null)
        await query("update relationship_onboarding_sessions set status='completed' where id in($1,$2)", [id(500), id(504)])
        assert.equal(related(await run(users.partial), 'onboarding')[0].status, 'completed', 'unreadable active sessions do not hide permitted completed history')
        await query("update relationship_onboarding_sessions set status='archived',archived_at=now() where id=$1", [id(504)])
        assert.equal(related(await run(users.partial), 'onboarding')[0].session_id, id(500))
        await query("delete from workspace_service_capabilities where workspace_id=$1 and service_id=$2", [workspace, id(400)])
        assert.equal(related(await run(users.partial), 'onboarding').length, 0, 'panel capability revocation removes session destination')
        await query("insert into workspace_service_capabilities values($1,$2,'onboarding.manage')", [workspace, id(400)])
        report('permitted session chooser, completed fallback, archive exclusion and current panel-capability revocation')

        await db.exec('begin')
        try {
            await relation(5000, 'WindowSeed')
            await query('insert into relationship_services values($1,$2,$3,$4)', [workspace, id(5000), id(400), users.partial])
            await query('insert into relationship_service_instances(id,workspace_id,relationship_id,service_id,assignee_user_id) values($1,$2,$3,$4,$5)', [id(5800), workspace, id(5000), id(400), users.partial])
            for (let n = 1; n <= 100; n++) {
                await work(6000 + n, 5000, { service_id: id(n === 1 || n === 21 ? 400 : 401), status: n === 1 ? 'doing' : 'todo', created_at: new Date(Date.UTC(2300, 0, 1) - n * 1000).toISOString() })
                await query("update work_item_relationships set created_at='2000-01-01'::timestamptz+$1*interval '1 second' where work_item_id=$2", [n, id(6000 + n)])
            }
            for (let n = 1; n <= 30; n++) await session(7000 + n, 5000, { service_scope: 'selected_services', source_sale_id: id(600), created_at: new Date(Date.UTC(2000, 0, 1) + n * 1000).toISOString() })
            const allowSession = async n => {
                await query("insert into relationship_onboarding_session_modules(id,workspace_id,session_id,source_kind) values($1,$2,$3,'service')", [id(8000 + n), workspace, id(7000 + n)])
                await query('insert into service_instance_module_requirements values($1,$2,$3,$4,true)', [workspace, id(5800), id(7000 + n), id(8000 + n)])
            }
            await allowSession(10)
            await allowSession(11)
            let windowed = await run(users.partial, 'WindowSeed')
            assert.deepEqual(related(windowed, 'work_item', id(5000)).map(row => row.id), [id(6021)], '80th newest link remains eligible; older high-priority readable work stays outside suggestions')
            assert.equal(related(windowed, 'onboarding', id(5000))[0].session_id, id(7011), '20th newest permitted session is selected after newer denied sessions')
            await query("update work_items set status='done' where id>= $1 and id<= $2", [id(6021), id(6100)])
            await query("update relationship_onboarding_sessions set status='archived',archived_at=now() where id=$1", [id(7011)])
            windowed = await run(users.partial, 'WindowSeed')
            assert.deepEqual(related(windowed, 'work_item', id(5000)), [], 'closed source-window work never causes a scan into older links')
            assert.deepEqual(related(windowed, 'onboarding', id(5000)), [], 'archived/denied source-window sessions never fall through to older history')
            await allowSession(20)
            await query("update relationship_onboarding_sessions set status='completed' where id=$1", [id(7020)])
            windowed = await run(users.partial, 'WindowSeed')
            assert.equal(related(windowed, 'onboarding', id(5000))[0].session_id, id(7020), 'completed fallback reuses the same recent source window')
            await allowSession(21)
            await query("update relationship_onboarding_sessions set status='completed' where id=$1", [id(7021)])
            assert.equal(related(await run(users.partial, 'WindowSeed'), 'onboarding', id(5000))[0].session_id, null, 'two permitted completed sessions within the window use the chooser')
        } finally { await db.exec('rollback') }
        report('recent 80-link/20-session boundaries precede permission/usefulness and share completed/active selection')

        await query('insert into relationship_client_chat_members values($1,$2,$3)', [workspace, id(300), users.partial])
        assert.equal(related(await run(users.partial), 'client_chat').length, 1)
        await query('delete from workspace_team_members where team_id=$1 and user_id=$2', [id(1000), users.partial])
        const clientOnly = await run(users.partial)
        assert.equal(related(clientOnly, 'team_chat').length, 0)
        assert.equal(related(clientOnly, 'client_chat').length, 1, 'client roster is independent after Team revocation')
        await query('delete from relationship_client_chat_members where relationship_id=$1 and user_id=$2', [id(300), users.partial])
        assert.equal(related(await run(users.partial), 'client_chat').length, 0)
        await query('insert into workspace_team_members values($1,$2,$3)', [workspace, id(1000), users.partial])
        await query('update workspace_native_conversations set archived_at=now() where id=$1', [id(1100)])
        assert.equal(related(await run(users.partial), 'team_chat').length, 0)
        await query('update workspace_native_conversations set archived_at=null where id=$1', [id(1100)])
        await query('update workspace_teams set archived_at=now() where id=$1', [id(1000)])
        assert.equal(related(await run(users.partial), 'team_chat').length, 0)
        await query('update workspace_teams set archived_at=null where id=$1', [id(1000)])
        await query('delete from workspace_memberships where workspace_id=$1 and user_id=$2', [workspace, users.partial])
        assert.equal(await run(users.partial), null, 'roster rows never bypass revoked workspace membership')
        await query("insert into workspace_memberships values($1,$2,'member')", [workspace, users.partial])
        assert.equal((await run(users.partial)).role, 'staff', 'legacy membership role normalizes to staff')
        report('chat and workspace revocations are fresh; archived chats excluded; legacy role normalization preserved')

        for (const relationship of [300, 301]) {
            await query('insert into relationship_client_chat_members values($1,$2,$3)', [workspace, id(relationship), users.owner])
            await query('insert into workspace_team_members values($1,$2,$3)', [workspace, id(relationship + 700), users.owner])
        }
        await work(920, 301, { due_date: '2000-01-01' })
        await work(921, 301, { due_date: '2000-01-02' })
        assert.equal((await run(users.owner)).related.length, 10, 'two full families emit exactly the maximum ten destinations')
        await query('insert into work_item_relationships(workspace_id,work_item_id,relationship_id) values($1,$2,$3)', [workspace, id(900), id(301)])
        const shared = await run(users.owner)
        assert.equal(shared.related.filter(row => row.kind === 'work_item' && row.id === id(900)).length, 1)
        await query("update relationships set status='archived' where id=$1", [id(300)])
        assert.equal((await run(users.owner)).related.filter(row => row.relationship_id === id(300)).length, 0)
        report('maximum related payload, shared-destination deduplication and archived seed exclusion')

        await work(940, 301, { title: 'archive-probe work', metadata: { archived_at: '2020-01-01' } })
        await work(941, 301, { title: 'archive-probe work' })
        await query("insert into assets(id,workspace_id,title,metadata,created_at) values($1,$2,'archive-probe attachment','{\"archived_at\":\"2020-01-01\"}','2099-01-01'),($3,$2,'archive-probe attachment','{}','2000-01-01')", [id(1500), workspace, id(1501)])
        await query("insert into onboarding_modules(id,workspace_id,internal_code,status) values($1,$2,'archive-probe-old','archived'),($3,$2,'archive-probe-current','active')", [id(1600), workspace, id(1601)])
        for (const number of [1600, 1601]) await query("insert into onboarding_module_revisions(id,workspace_id,module_id,status,definition) values($1,$2,$3,'published','{\"name\":\"archive-probe module\"}')", [id(number + 100), workspace, id(number)])
        await query("insert into onboarding_services(id,workspace_id,internal_code,state) values($1,$2,'archive-probe-old','archived'),($3,$2,'archive-probe-current','active')", [id(1800), workspace, id(1801)])
        for (const number of [1800, 1801]) await query("insert into onboarding_service_revisions(id,workspace_id,service_id,name) values($1,$2,$3,'archive-probe service')", [id(number + 100), workspace, id(number)])
        const archive = await run(users.owner, 'archive-probe')
        assert.deepEqual(archive.work_items.map(row => [row.id, row.archived]), [[id(941), false], [id(940), true]])
        assert.deepEqual(archive.assets.map(row => [row.id, row.archived]), [[id(1501), false], [id(1500), true]])
        assert.deepEqual(archive.modules.map(row => row.id), [id(1601), id(1600)])
        assert.equal(archive.modules[1].status, 'archived', 'published revision never masks its archived module parent')
        assert.deepEqual(archive.services.map(row => row.id), [id(1801), id(1800)])
        assert.equal(archive.services[1].state, 'archived')
        await run(users.partial, 'archive-probe')
        await query("update workspaces set status='inactive' where id=$1", [workspace])
        assert.equal(await run(users.owner), null)
        report('direct work/assets archive metadata, active-first module/service ordering and inactive workspace denial')
        console.log(`PASS: ${passed} search capability SQL groups; real canonical policies, isolated data, no production calls`)
    } finally { await db.close() }
}


export async function validateCapabilityEarlyStop() {
    const fixture = await createCapabilityFixture()
    const { db, query, search, withRole, policies } = fixture
    try {
      await query("insert into workspaces(id,slug,name) values($1,'synthetic','Synthetic')", [workspace])
      await query("insert into workspace_memberships values($1,$2,'staff')", [workspace, users.partial])
      await query("insert into relationships(id,workspace_id,primary_person_name,seller_user_id) values($1,$2,'Jason',$3)", [id(300), workspace, users.partial])
      await query("insert into onboarding_services(id,workspace_id,internal_code) values($1,$2,'service-a')", [id(400), workspace])
      await query('insert into workspace_member_service_access values($1,$2,$3)', [workspace, users.partial, id(400)])
      await query("insert into workspace_service_capabilities values($1,$2,'onboarding.manage')", [workspace, id(400)])
      await query('insert into client_sales values($1,$2,$3,$3)', [id(600), workspace, users.partial])
      for (let n=0;n<6;n++) {
        await query("insert into work_items(id,workspace_id,title,service_id,status,due_date,created_at) values($1,$2,$3,$4,'todo','2099-01-01',$5)", [id(900+n),workspace,`Unrelated task ${n}`,id(400),new Date(Date.UTC(2020,0,1)+n*1000).toISOString()])
        await query('insert into work_item_relationships(workspace_id,work_item_id,relationship_id) values($1,$2,$3)', [workspace,id(900+n),id(300)])
      }
      for (let n=0;n<5;n++) await query("insert into relationship_onboarding_sessions(id,workspace_id,relationship_id,status,service_scope,source_sale_id,created_at) values($1,$2,$3,'active','selected_services',$4,$5)", [id(500+n),workspace,id(300),id(600),new Date(Date.UTC(2020,0,1)+n*1000).toISOString()])
      const measuredNames=['workspace_user_can_access_work_item','workspace_user_can_access_full_onboarding_session']
      for (const name of measuredNames) {
        const policy=policies.find(policy=>policy.name===name)
        await db.exec(policy.sql.replace(`public.${name}(`,`public.fixture_${name}(`))
        await db.exec(`create sequence fixture_${name}_calls minvalue 0 start 0`)
        const recordParameter=name==='workspace_user_can_access_work_item'?'p_work_item_id':'p_session_id'
        await db.exec(`create or replace function public.${name}(p_workspace_id uuid,${recordParameter} uuid,p_user_id uuid default auth.uid()) returns boolean language plpgsql volatile security definer set search_path=public as $$ begin perform nextval('fixture_${name}_calls'); return fixture_${name}(p_workspace_id,${recordParameter},p_user_id); end $$`)
      }
      const snapshot=await withRole('service_role',()=>search(users.partial,'Jason'))
      assertCapabilityProjection(snapshot)
      assert.deepEqual(snapshot.work_items,[], 'direct work matching must not contaminate related-only policy counts')
      assert.deepEqual(snapshot.related.filter(row=>row.kind==='work_item').map(row=>row.id),[id(900),id(901)])
      assert.equal(snapshot.related.find(row=>row.kind==='onboarding').session_id,null)
      const counts={}
      for(const name of measuredNames) {
        const counter=(await query(`select last_value,is_called from fixture_${name}_calls`)).rows[0]
        counts[name]=counter.is_called?Number(counter.last_value)+1:0
        assert.equal(counts[name],2,`${name} stops after two permitted destinations`)
      }
      console.log('PASS: readable related work and sessions stop after two canonical authorization checks')
    } finally { await db.close() }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    await validateCapabilityCorrectness()
    await validateCapabilityEarlyStop()
}
