import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { PGlite, repositoryRoot } from "./pglite-fixture.mjs"

// Run with BE_PGLITE_ROOT=/tmp/betelgeze-library-sql node scripts/validate-relationship-queue-refresh.mjs.
// The complete old and new queue migrations run against a disposable projection of
// their tables. Permission functions are fixture boundaries, not production-policy
// coverage. No application server, provider or production database is contacted.
const db = new PGlite()
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`
const workspace = id(1), foreignWorkspace = id(2), relationship = id(3), otherRelationship = id(4)
const admin = id(5), staff = id(6), outsider = id(7), owner = id(8), sop = id(9)
const baselineName = "read_relationship_work_queue_baseline"
const candidateName = "read_relationship_work_queue"
const one = async (sql, parameters = []) => (await db.query(sql, parameters)).rows[0]
const queue = async (actor = admin, offset = 0, name = candidateName, targetWorkspace = workspace, targetRelationship = relationship) =>
    (await one(`select public.${name}($1,$2,$3,$4) result`, [targetWorkspace, targetRelationship, actor, offset])).result
const migration = name => readFile(`${repositoryRoot}/supabase/migrations/${name}`, "utf8")
let checks = 0
const pass = label => console.log(`PASS ${++checks}: ${label}`)
const withoutGeneration = page => {
    const result = { ...page }
    delete result.generation
    return result
}
const stats = observations => {
    const values = [...observations].sort((a, b) => a - b)
    return { samples: values.length, medianMs: values[Math.floor(values.length / 2)], p95Ms: values[Math.ceil(values.length * .95) - 1], minMs: values[0], maxMs: values.at(-1) }
}
try {
    await db.exec(`
        create role anon; create role authenticated; create role service_role bypassrls;
        create table workspace_memberships(workspace_id uuid,user_id uuid,role text,primary key(workspace_id,user_id));
        create table relationships(id uuid primary key,workspace_id uuid);
        create table fixture_relationship_access(relationship_id uuid,user_id uuid,primary key(relationship_id,user_id));
        create table fixture_work_access(work_item_id uuid,user_id uuid,primary key(work_item_id,user_id));
        create function workspace_user_can_access_relationship(p_workspace uuid,p_relationship uuid,p_user uuid)
        returns boolean language sql stable as $$ select exists(
          select 1 from relationships r join workspace_memberships m on m.workspace_id=r.workspace_id
          where r.id=p_relationship and r.workspace_id=p_workspace and m.user_id=p_user
          and (m.role in ('owner','admin') or exists(select 1 from fixture_relationship_access a where a.relationship_id=r.id and a.user_id=p_user))) $$;
        create function workspace_user_can_access_work_item(p_workspace uuid,p_work uuid,p_user uuid)
        returns boolean language sql stable as $$ select exists(
          select 1 from workspace_memberships m where m.workspace_id=p_workspace and m.user_id=p_user
          and (m.role in ('owner','admin') or exists(select 1 from fixture_work_access a where a.work_item_id=p_work and a.user_id=p_user))) $$;
        create table user_profiles(user_id uuid primary key,display_name text,username text);
        create table onboarding_services(id uuid primary key,workspace_id uuid,internal_code text);
        create table onboarding_service_revisions(id uuid primary key,workspace_id uuid,service_id uuid,name text,revision_number integer);
        create table relationship_service_instances(id uuid primary key,workspace_id uuid,relationship_id uuid,service_key text,service_revision_id uuid);
        create table work_items(id uuid primary key,workspace_id uuid,title text,status text,workflow_action text,
          due_date date,planned_start_date date,updated_at timestamptz default now(),created_at timestamptz default now(),
          priority integer default 3,native_kind text,metadata jsonb default '{}',created_by uuid,service_id uuid,workflow_role text default 'task');
        create table work_item_relationships(workspace_id uuid,relationship_id uuid,work_item_id uuid,created_at timestamptz default now(),primary key(work_item_id,relationship_id));
        create table work_item_dependencies(workspace_id uuid,work_item_id uuid,depends_on_work_item_id uuid,primary key(work_item_id,depends_on_work_item_id));
        create table work_item_assignees(workspace_id uuid,work_item_id uuid,user_id uuid,primary key(work_item_id,user_id));
        create table service_instance_work_items(workspace_id uuid,instance_id uuid,work_item_id uuid,primary key(instance_id,work_item_id));
        create table sop_work_runs(id uuid primary key,workspace_id uuid,instance_id uuid,status text,error_summary text,
          unique(workspace_id,instance_id));
        create table sop_work_requests(instance_id uuid primary key,workspace_id uuid,relationship_id uuid,sop_id uuid,
          status text check(status in ('pending','accepted','failed')),run_id uuid references sop_work_runs(id),error_summary text,created_at timestamptz default now());
        insert into workspace_memberships values('${workspace}','${admin}','admin'),('${workspace}','${owner}','owner'),('${workspace}','${staff}','staff');
        insert into relationships values('${relationship}','${workspace}'),('${otherRelationship}','${workspace}'),('${id(10)}','${foreignWorkspace}');
        insert into fixture_relationship_access values('${relationship}','${staff}');
        insert into user_profiles values('${staff}','Assigned member','staff');
        insert into onboarding_services values('${id(11)}','${workspace}','ads');
        insert into onboarding_service_revisions values('${id(12)}','${workspace}','${id(11)}','Ads',1);
        insert into relationship_service_instances values('${id(13)}','${workspace}','${relationship}','ads','${id(12)}');
    `)
    // Reuse actual existing index definitions: the repair introduces no new index.
    for (const [file, names] of [
        ["20260710120000_canonical_work_items_assets.sql", ["work_item_relationships_relationship_idx"]],
        ["20260912120000_service_instance_foundation.sql", ["service_instance_work_lookup_idx"]],
        ["20260914110000_sop_work_pilot.sql", ["sop_work_requests_relationship_idx"]],
    ]) {
        const source = await migration(file)
        for (const name of names) {
            const statement = source.match(new RegExp(`create index (?:if not exists )?${name}\\b[^;]*;`, "i"))?.[0]
            assert.ok(statement, `Existing index ${name} must be available`)
            await db.exec(statement)
        }
    }
    await db.exec(`
        insert into work_items(id,workspace_id,title,status,created_at,created_by,service_id)
          select ('00000000-0000-4000-8000-'||lpad((1000+n)::text,12,'0'))::uuid,'${workspace}','Task '||n,
          case when n=61 then 'done' when n=62 then 'canceled' else 'todo' end,
          now()-n*interval '1 minute','${staff}','${id(11)}' from generate_series(1,62) n;
        insert into work_item_relationships(workspace_id,relationship_id,work_item_id) select workspace_id,'${relationship}',id from work_items;
        insert into work_item_assignees select workspace_id,id,'${staff}' from work_items;
        insert into service_instance_work_items select workspace_id,'${id(13)}',id from work_items;
        insert into fixture_work_access select id,'${staff}' from work_items where title in ('Task 1','Task 2');
        insert into sop_work_runs values
          ('${id(201)}','${workspace}','${id(101)}','queued',null),
          ('${id(202)}','${workspace}','${id(102)}','running',null),
          ('${id(203)}','${workspace}','${id(103)}','published',null),
          ('${id(205)}','${workspace}','${id(105)}','failed','Run failed'),
          ('${id(206)}','${workspace}','${id(106)}','published',null),
          ('${id(207)}','${foreignWorkspace}','${id(107)}','running','Foreign secret');
        insert into sop_work_requests(instance_id,workspace_id,relationship_id,sop_id,status,run_id,error_summary) values
          ('${id(100)}','${workspace}','${relationship}','${sop}','pending',null,null),
          ('${id(101)}','${workspace}','${relationship}','${sop}','accepted','${id(201)}',null),
          ('${id(102)}','${workspace}','${relationship}','${sop}','accepted','${id(202)}',null),
          ('${id(103)}','${workspace}','${relationship}','${sop}','accepted','${id(203)}',null),
          ('${id(104)}','${workspace}','${relationship}','${sop}','failed',null,'Request failed'),
          ('${id(105)}','${workspace}','${relationship}','${sop}','accepted','${id(205)}',null),
          ('${id(106)}','${workspace}','${relationship}','${sop}','pending',null,null),
          ('${id(107)}','${workspace}','${relationship}','${sop}','accepted','${id(207)}',null),
          ('${id(108)}','${workspace}','${otherRelationship}','${sop}','failed',null,'Other relationship secret'),
          ('${id(109)}','${foreignWorkspace}','${id(10)}','${sop}','failed',null,'Other workspace secret');
    `)
    await db.exec(await migration("20260914180000_relationship_queue_presentation.sql"))
    const before = await queue()
    assert.equal(Object.hasOwn(before, "generation"), false)
    assert.equal(before.items.length, 31)
    assert.equal(before.hasMore, true)
    assert.deepEqual(before.items[0].services, ["Ads"])
    assert.equal(before.items[0].assignees[0].username, "Assigned member")
    const beforeStaff = await queue(staff)
    assert.equal(beforeStaff.items.length, 2)
    const functionState = async () => one(`select proacl::text,prosecdef,provolatile,proconfig from pg_proc where oid='public.${candidateName}(uuid,uuid,uuid,integer)'::regprocedure`)
    const privileges = await functionState()
    const baseline = (await one(`select pg_get_functiondef('public.${candidateName}(uuid,uuid,uuid,integer)'::regprocedure) definition`)).definition
    await db.exec(baseline.replace(`public.${candidateName}(`, `public.${baselineName}(`))
    pass("Complete presentation migration reproduces missing generation metadata while preserving queue records")

    const repair = await readFile(`${repositoryRoot}/docs/assignee-transfer/queue-refresh-prototype.sql`, "utf8")
    await db.exec(repair)
    assert.deepEqual(await functionState(), privileges)
    assert.equal((await one(`select has_function_privilege('service_role','public.${candidateName}(uuid,uuid,uuid,integer)','execute') permitted`)).permitted, true)
    for (const role of ["anon", "authenticated"]) {
        assert.equal((await one(`select has_function_privilege($1,'public.${candidateName}(uuid,uuid,uuid,integer)','execute') permitted`, [role])).permitted, false)
    }
    const after = await queue()
    assert.deepEqual(withoutGeneration(after), before)
    const byInstance = new Map(after.generation.map(run => [run.instance_id, run]))
    assert.equal(byInstance.size, 8)
    for (const [number, status] of [[100,"pending"],[101,"queued"],[102,"running"],[103,"published"],[104,"failed"],[105,"failed"],[106,"pending"],[107,"accepted"]]) {
        assert.equal(byInstance.get(id(number)).status, status)
    }
    assert.equal(byInstance.get(id(104)).error_summary, "Request failed")
    assert.equal(byInstance.get(id(105)).error_summary, "Run failed")
    assert.equal(byInstance.get(id(106)).run_id, null, "An unreferenced run must not replace pending request status")
    assert.equal(byInstance.get(id(107)).error_summary, null, "A foreign-workspace run must not leak metadata")
    assert.equal(JSON.stringify(after).includes("secret"), false)
    assert.deepEqual(await queue(owner), after)
    pass("Complete repair restores pending/queued/running/published/failure states, exact run identity and owner/admin-only metadata")

    assert.deepEqual(await queue(staff), beforeStaff)
    for (const offset of [30, 60]) {
        assert.deepEqual(await queue(admin, offset), await queue(admin, offset, baselineName))
        assert.equal(Object.hasOwn(await queue(admin, offset), "generation"), false)
    }
    await assert.rejects(queue(outsider), /Relationship access required/)
    await assert.rejects(queue(admin, 0, candidateName, foreignWorkspace), /Relationship access required/)
    await assert.rejects(queue(staff, 0, candidateName, workspace, otherRelationship), /Relationship access required/)
    await assert.rejects(queue(admin, -1), /Invalid page/)
    await assert.rejects(queue(admin, 10001), /Invalid page/)
    pass("Staff task visibility, pagination, access rejection and function privileges remain unchanged")
    await assert.rejects(db.exec(repair), /Unexpected relationship queue function/)
    await db.exec("rollback")
    assert.deepEqual(await queue(), after)
    pass("Unexpected reapplication fails without changing the installed function")

    // Growth fixture: 10,000 historical requests on the target relationship plus
    // 10,000 newer requests in other scopes. Current target requests remain recent.
    await db.exec(`
        insert into sop_work_runs(id,workspace_id,instance_id,status)
          select ('00000000-0000-4000-8000-'||lpad((100000+n)::text,12,'0'))::uuid,
          case when n>15000 then '${foreignWorkspace}'::uuid else '${workspace}'::uuid end,
          ('00000000-0000-4000-8000-'||lpad((200000+n)::text,12,'0'))::uuid,'published'
          from generate_series(1,20000) n;
        insert into sop_work_requests(instance_id,workspace_id,relationship_id,sop_id,status,run_id,created_at)
          select ('00000000-0000-4000-8000-'||lpad((200000+n)::text,12,'0'))::uuid,
          case when n>15000 then '${foreignWorkspace}'::uuid else '${workspace}'::uuid end,
          case when n<=10000 then '${relationship}'::uuid when n<=15000 then '${otherRelationship}'::uuid else '${id(10)}'::uuid end,
          '${sop}','accepted',('00000000-0000-4000-8000-'||lpad((100000+n)::text,12,'0'))::uuid,
          case when n<=10000 then now()-interval '1 day'-n*interval '1 second' else now() end
          from generate_series(1,20000) n;
        analyze;
    `)
    const grown = await queue()
    assert.equal(grown.generation.length, 10)
    assert.equal(new Set(grown.generation.map(row => row.instance_id)).size, 10)
    assert.deepEqual(withoutGeneration(grown), before)
    assert.deepEqual(await queue(staff), beforeStaff)
    const plan = (await one(`explain(analyze,buffers,format json)
        select q.instance_id,q.sop_id,coalesce(j.id,q.run_id) run_id,coalesce(j.status,q.status) status,coalesce(j.error_summary,q.error_summary) error_summary
        from (select * from public.sop_work_requests where workspace_id=$1 and relationship_id=$2 order by created_at desc limit 10) q
        left join public.sop_work_runs j on j.workspace_id=q.workspace_id and j.id=q.run_id`, [workspace, relationship]))["QUERY PLAN"][0]
    const nodes = []
    function visit(node) { nodes.push(node); for (const child of node.Plans ?? []) visit(child) }
    visit(plan.Plan)
    const requestScan = nodes.find(node => node["Index Name"] === "sop_work_requests_relationship_idx")
    assert.ok(requestScan, "Existing relationship index must bound request history")
    assert.equal(requestScan["Actual Rows"], 10)
    assert.ok(nodes.some(node => node["Index Name"] === "sop_work_runs_pkey"))
    assert.ok(nodes.filter(node => node["Index Name"] === "sop_work_runs_pkey").every(node => node["Actual Loops"] <= 10))
    pass("20,010 request fixture retains a ten-request indexed window and at most ten run primary-key probes")

    const measurements = []
    for (const [label, actor, offset] of [["admin-first-page",admin,0],["staff-first-page",staff,0],["admin-second-page",admin,30]]) {
        const arms = { baseline: [], candidate: [] }
        const measure = async name => (await one(`explain(analyze,format json) select public.${name}($1,$2,$3,$4)`, [workspace,relationship,actor,offset]))["QUERY PLAN"][0]["Execution Time"]
        for (let i = 0; i < 8; i++) { await measure(baselineName); await measure(candidateName) }
        for (let i = 0; i < 40; i++) {
            for (const arm of i % 2 ? ["candidate","baseline"] : ["baseline","candidate"]) arms[arm].push(await measure(arm === "baseline" ? baselineName : candidateName))
        }
        const baselineResult = await queue(actor, offset, baselineName)
        const candidateResult = await queue(actor, offset)
        measurements.push({ label, baseline: stats(arms.baseline), candidate: stats(arms.candidate),
            baselineBytes: Buffer.byteLength(JSON.stringify(baselineResult)), candidateBytes: Buffer.byteLength(JSON.stringify(candidateResult)) })
    }
    console.log(JSON.stringify({ checks, measurements, generationPlan: nodes.map(node => ({ type: node["Node Type"], index: node["Index Name"], rows: node["Actual Rows"], loops: node["Actual Loops"] })),
        limits: "Synthetic in-process PostgreSQL/PGlite database-only observations; permission functions are fixtures. Excludes production policies, network, authentication, concurrent workload, browser refresh behavior and physical devices." }, null, 2))
} catch (error) {
    console.error(error.message)
    process.exitCode = 1
} finally {
    await db.close()
}
