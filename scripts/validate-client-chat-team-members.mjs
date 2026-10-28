import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { PGlite } from './pglite-fixture.mjs'

const db = process.argv.includes('--native') ? await (await import('./client-chat-members-postgres.mjs')).createClientChatPostgresFixture() : new PGlite()
const id = number => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`
const [w, otherW, client, otherClient, team, otherTeam, manager, seller, staff, shared, outsider, owner, former] = Array.from({ length: 13 }, (_, n) => id(n + 1))
const call = async (name, args) => (await db.query(`select public.${name}(${args.map((_, n) => `$${n + 1}`).join(',')}) value`, args)).rows[0].value
const count = async table => Number((await db.query(`select count(*) n from ${table}`)).rows[0].n)
const baseline = await readFile(new URL('../supabase/migrations/20260909100000_client_delivery_teams.sql', import.meta.url), 'utf8')
const baselineFunction = name => baseline.match(new RegExp(`create function public\\.${name}\\([\\s\\S]*?\\$\\$;`))[0]
try {
    await db.exec(`
        create role anon; create role authenticated; create role service_role;
        create table workspace_memberships(workspace_id uuid,user_id uuid,role text,primary key(workspace_id,user_id));
        create table relationships(id uuid primary key,workspace_id uuid,seller_user_id uuid,fulfilment_manager_user_id uuid,status text default 'active',business_name text,primary_person_name text);
        create table workspace_teams(id uuid primary key,workspace_id uuid,relationship_id uuid,kind text default 'relationship',archived_at timestamptz);
        create unique index workspace_teams_relationship_unique on workspace_teams(workspace_id,relationship_id) where relationship_id is not null;
        create table workspace_team_members(workspace_id uuid,team_id uuid,user_id uuid,primary key(team_id,user_id));
        create table relationship_services(workspace_id uuid,relationship_id uuid,assignee_user_id uuid);
        create index relationship_services_relationship_idx on relationship_services(workspace_id,relationship_id);
        create table relationship_client_chat_members(workspace_id uuid,relationship_id uuid,user_id uuid,added_by uuid,added_at timestamptz default clock_timestamp(),primary key(relationship_id,user_id),foreign key(workspace_id,user_id) references workspace_memberships(workspace_id,user_id));
        create table relationship_team_events(workspace_id uuid,relationship_id uuid,actor_user_id uuid,event_type text,details jsonb);
        create schema auth; create function auth.uid() returns uuid language sql as $$select null::uuid$$;
    `)
    await db.exec(baselineFunction('client_conversation_can_access'))
    await db.exec(baselineFunction('set_client_chat_members'))
    for (const user of [manager, seller, staff, shared, outsider, owner]) await db.query('insert into workspace_memberships values($1,$2,$3)', [w, user, user === owner ? 'owner' : 'staff'])
    await db.query('insert into workspace_memberships values($1,$2,$3)', [otherW, manager, 'owner'])
    await db.query("insert into relationships values($1,$2,$3,$4,'active','Client','Person'),($5,$6,$3,$4,'active','Other','Person')", [client,w,seller,manager,otherClient,otherW])
    await db.query('insert into workspace_teams(id,workspace_id,relationship_id) values($1,$2,$3),($4,$5,$6)', [team,w,client,otherTeam,otherW,otherClient])
    for (const user of [manager,seller,staff,shared,former]) await db.query('insert into workspace_team_members values($1,$2,$3)', [w,team,user])
    await db.query('insert into relationship_services values($1,$2,$3)', [w,client,staff])
    await assert.rejects(call('set_client_chat_members',[w,client,manager,[shared]]), /fulfilment staff/)
    console.log('PASS baseline reproduces shared Team member rejection')
    await db.exec(await readFile(new URL('../supabase/migrations/20261027120000_client_chat_team_members.sql', import.meta.url), 'utf8'))
    const read = (actor=manager, target=team, workspace=w) => call('read_team_client_chat_members',[workspace,target,actor])
    const add = (ids,actor=manager,target=team,workspace=w) => call('add_team_client_chat_members',[workspace,target,actor,ids])
    const roster = await read()
    assert.deepEqual(roster.eligibleIds, [staff,shared])
    assert.deepEqual(roster.memberIds, [manager,seller].sort())
    assert.equal(await call('client_conversation_can_access',[w,client,shared]),false)
    for (const actor of [seller,staff,shared,owner,outsider,former]) {
        await assert.rejects(read(actor),/assigned manager/)
        await assert.rejects(add([shared],actor),/assigned manager/)
    }
    await assert.rejects(read(manager,otherTeam),/assigned manager/)
    await assert.rejects(read(manager,team,otherW),/assigned manager/)
    for (const users of [[outsider],[former],[seller],[manager],[staff,outsider]]) await assert.rejects(add(users),/current members/)
    for (const users of [[],null,[null],Array(201).fill(staff)]) await assert.rejects(add(users),/Choose between/)
    assert.equal(await count('relationship_client_chat_members'),0)
    assert.equal(await count('relationship_team_events'),0)
    for (const role of ['anon','authenticated']) {
        await db.exec(`set role ${role}`)
        await assert.rejects(read(),/permission denied/)
        await assert.rejects(add([shared]),/permission denied/)
        await db.exec('reset role')
    }
    console.log('PASS manager-only, workspace/relationship scope, active members, atomic rejection, grants and input bounds')

    await db.exec(`begin;
        create temporary table oversized_team_fixture as select gen_random_uuid() user_id from generate_series(1,201);
        insert into workspace_memberships select '${w}'::uuid,user_id,'staff' from oversized_team_fixture;
        insert into workspace_team_members select '${w}'::uuid,'${team}'::uuid,user_id from oversized_team_fixture;`)
    await assert.rejects(read(),/too large/)
    await db.exec('rollback')
    console.log('PASS oversized Team roster fails explicitly without partial choices')

    await db.exec('set role service_role')
    const first = await add([shared,shared])
    assert.deepEqual(first.addedUserIds,[shared])
    assert.ok(first.memberIds.includes(shared))
    await db.exec('reset role')
    const original = (await db.query('select * from relationship_client_chat_members')).rows[0]
    assert.equal(await call('client_conversation_can_access',[w,client,shared]),true)
    assert.deepEqual((await add([shared])).addedUserIds,[])
    assert.equal(await count('relationship_team_events'),1)
    await add([staff])
    assert.equal(await count('relationship_client_chat_members'),2)
    assert.deepEqual((await db.query('select * from relationship_client_chat_members where user_id=$1',[shared])).rows[0],original)
    assert.equal(await count('workspace_team_members'),5)
    console.log('PASS shared member gains access; additive saves and lost-ack retries preserve existing membership and attribution')

    // A fresh copy cannot plan a Team lookup while its table is unavailable.
    // Ordinary service-only saves must still succeed; new choices must fail
    // closed, and the real setter continues to retain every existing grant.
    const candidateDefinition = (await readFile(new URL('../supabase/migrations/20261027120000_client_chat_team_members.sql', import.meta.url),'utf8')).match(/create or replace function public\.set_client_chat_members\([\s\S]*?\$\$;/)[0]
    await db.exec(candidateDefinition.replace('public.set_client_chat_members(', 'public.fast_path_fixture('))
    await db.exec('begin; alter table workspace_teams rename to unavailable_team_fixture')
    await call('fast_path_fixture',[w,client,manager,[staff]])
    assert.equal(await call('client_conversation_can_access',[w,client,staff]),true)
    await db.exec('savepoint new_choice')
    await assert.rejects(call('fast_path_fixture',[w,client,manager,[shared]]),/workspace_teams/)
    await db.exec('rollback to savepoint new_choice; rollback')
    console.log('PASS existing service saves never plan or execute the broader Team lookup; unsupported choices fail closed')

    await call('set_client_chat_members',[w,client,manager,[shared,staff]])
    assert.deepEqual((await db.query('select * from relationship_client_chat_members where user_id=$1',[shared])).rows[0],original)
    await db.query('delete from workspace_team_members where user_id=$1',[shared])
    await call('set_client_chat_members',[w,client,manager,[shared,staff]])
    assert.equal(await call('client_conversation_can_access',[w,client,shared]),true)
    await call('set_client_chat_members',[w,client,manager,[staff]])
    assert.equal(await call('client_conversation_can_access',[w,client,shared]),false)
    await assert.rejects(add([shared]),/current members/)
    await assert.rejects(call('set_client_chat_members',[w,client,manager,[outsider]]),/team members/)
    assert.equal(await call('client_conversation_can_access',[w,client,staff]),true)
    console.log('PASS Client editor retains and removes explicit grants without changing Team membership')

    if(db.connect){
        await db.query('insert into workspace_team_members values($1,$2,$3)',[w,team,shared])
        const a=await db.connect(),b=await db.connect()
        const pid=(await b.query('select pg_backend_pid() pid')).rows[0].pid
        const auditBefore=await count('relationship_team_events')
        await a.query('begin')
        await a.query('select add_team_client_chat_members($1,$2,$3,$4)',[w,team,manager,[shared]])
        const waiting=b.query('select add_team_client_chat_members($1,$2,$3,$4) value',[w,team,manager,[shared,staff]])
        waiting.catch(()=>{})
        const deadline=Date.now()+3000
        let locked=false
        while(Date.now()<deadline){
            locked=(await db.query('select exists(select 1 from pg_locks where pid=$1 and not granted) waiting',[pid])).rows[0].waiting
            if(locked)break
            await new Promise(resolve=>setTimeout(resolve,10))
        }
        assert.ok(locked,'overlapping additions must wait for the relationship lock')
        await a.query('commit')
        assert.deepEqual((await waiting).rows[0].value.addedUserIds,[])
        assert.equal((await read()).memberIds.filter(user=>user===shared).length,1)
        assert.equal(await count('relationship_team_events'),auditBefore+1)
        console.log('PASS independent PostgreSQL connections serialize overlapping additions without duplicate access or audit')
    }

    // Matched database-only observations of the existing Client editor save.
    // Each arm starts with identical explicit grants; all data is synthetic.
    const candidateSetter = candidateDefinition
    const oldSetter = baselineFunction('set_client_chat_members').replace('create function','create or replace function')
    const fixtureUsers=Array.from({length:40},(_,n)=>id(100+n))
    for(const user of fixtureUsers){
        await db.query('insert into workspace_memberships values($1,$2,$3)',[w,user,'staff'])
        await db.query('insert into relationship_services values($1,$2,$3)',[w,client,user])
    }
    await db.exec(`insert into relationship_services select '${w}'::uuid,gen_random_uuid(),gen_random_uuid() from generate_series(1,20000); analyze relationship_services; analyze workspace_memberships;`)
    // Separate names preserve each arm's cached plans. Replacing the same
    // function before every sample measures replanning, not ordinary saves.
    await db.exec(oldSetter.replace('public.set_client_chat_members(', 'public.baseline_set_members('))
    await db.exec(candidateSetter.replace('public.set_client_chat_members(', 'public.candidate_set_members('))
    // Match the old route's parallel reads with independent native connections.
    const rosterReaders=db.connect?await Promise.all(Array.from({length:4},()=>db.connect())):Array(4).fill(db)
    const evidence=[]
    for(const plan of ['first-plan','cached-plan'])for(const [scenario,before,after] of [
        ['unchanged',fixtureUsers.slice(0,20),fixtureUsers.slice(0,20)],
        ['add-one',fixtureUsers.slice(0,20),fixtureUsers.slice(0,21)],
        ['remove-one',fixtureUsers.slice(0,20),fixtureUsers.slice(0,19)],
        ['first-add',[],fixtureUsers.slice(0,1)],
    ]){
        const samples={baseline:[],candidate:[]},saveSamples={baseline:[],candidate:[]}
        for(let n=0;n<110;n++)for(const arm of n%2?['candidate','baseline']:['baseline','candidate']){
            // Force PL/pgSQL compilation/query planning only in this cohort.
            // Database buffers remain warm; this is not a cold database test.
            if(plan==='first-plan')await db.exec((arm==='baseline'?oldSetter:candidateSetter).replace('public.set_client_chat_members(',`public.${arm}_set_members(`))
            await db.query('delete from relationship_client_chat_members where relationship_id=$1',[client])
            await db.query('insert into relationship_client_chat_members(workspace_id,relationship_id,user_id,added_by) select $1,$2,unnest($3::uuid[]),$4',[w,client,before,manager])
            const start=performance.now()
            await call(arm==='candidate'?'candidate_set_members':'baseline_set_members',[w,client,manager,after])
            const rpcMs=performance.now()-start
            if(arm==='baseline')await Promise.all([
                rosterReaders[0].query('select seller_user_id,fulfilment_manager_user_id from relationships where workspace_id=$1 and id=$2',[w,client]),
                rosterReaders[1].query('select user_id from relationship_client_chat_members where workspace_id=$1 and relationship_id=$2',[w,client]),
                rosterReaders[2].query('select assignee_user_id from relationship_services where workspace_id=$1 and relationship_id=$2',[w,client]),
                rosterReaders[3].query('select user_id from workspace_memberships where workspace_id=$1',[w]),
            ])
            if(n>=10){samples[arm].push(rpcMs);saveSamples[arm].push(performance.now()-start)}
        }
        const summarize=groups=>Object.fromEntries(Object.entries(groups).map(([arm,values])=>{
            values.sort((a,b)=>a-b)
            return [arm,{samples:values.length,medianMs:+values[Math.floor(values.length/2)].toFixed(3),p95Ms:+values[Math.ceil(values.length*0.95)-1].toFixed(3)}]
        }))
        const summary={rpcOnly:summarize(samples),saveDatabaseCalls:summarize(saveSamples)}
        evidence.push({plan,scenario,serviceRows:20041,...summary})
        console.log(`Existing participant save (${plan}, ${scenario}), 20,041 service rows:`,JSON.stringify(summary))
    }
    if(process.env.CLIENT_CHAT_MEMBERS_SQL_EVIDENCE)await writeFile(process.env.CLIENT_CHAT_MEMBERS_SQL_EVIDENCE,JSON.stringify({runtime:(await db.query('select version() version')).rows[0].version,productionCalls:0,observations:evidence},null,2))
    await call('set_client_chat_members',[w,client,manager,[]])

    await db.query('update workspace_teams set archived_at=now() where id=$1',[team])
    await assert.rejects(add([staff]),/assigned manager/)
    await db.query('update workspace_teams set archived_at=null where id=$1',[team])
    await db.query("update relationships set status='archived' where id=$1",[client])
    await assert.rejects(read(),/assigned manager/)
    await db.query("update relationships set status='active',fulfilment_manager_user_id=$1 where id=$2",[outsider,client])
    await assert.rejects(add([staff]),/assigned manager/)
    await db.query('update relationships set fulfilment_manager_user_id=$1 where id=$2',[manager,client])
    await db.query('delete from workspace_memberships where workspace_id=$1 and user_id=$2',[w,manager])
    await assert.rejects(add([staff]),/assigned manager/)
    console.log('PASS archive, reassignment and offboarding revoke management immediately')
} finally { await db.close() }
