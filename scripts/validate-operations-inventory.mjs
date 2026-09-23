// Synthetic in-memory SQL only; no credentials, network or external database.
// PGLITE_PACKAGE_ROOT=/path/to/@electric-sql/pglite node scripts/validate-operations-inventory.mjs
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { pathToFileURL } from "node:url"
const { PGlite } = await import(process.env.PGLITE_PACKAGE_ROOT ? pathToFileURL(`${process.env.PGLITE_PACKAGE_ROOT}/dist/index.js`).href : "@electric-sql/pglite")
const db = new PGlite()
let checks = 0
function pass(name) { console.log(`ok ${++checks} - ${name}`) }
const catalog = await readFile("docs/consolidation/2026-09-23/operations/catalog-preflight.sql", "utf8")
const inventory = await readFile("docs/consolidation/2026-09-23/operations/leadgen-inventory.sql", "utf8")
try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create schema cron; create table cron.job(jobname text,active boolean,command text);
      insert into cron.job values('synthetic-job',true,'SECRET_COMMAND_MUST_NOT_BE_EXPORTED');
      create table public.leadgen_polls(id integer primary key,workspace_id integer,status text);
      insert into public.leadgen_polls values(1,1,'failed'),(2,1,'running');`)
    for (const name of ["leadgen_poll_tasks", "leadgen_investigation_tasks", "leadgen_poll_stage_runs", "leadgen_company_stage_status"]) {
        await db.exec(`create table public.${name}(poll_id integer,workspace_id integer,status text,raw_payload text);
          insert into public.${name} values(1,1,'queued','PRIVATE_PAYLOAD_MUST_NOT_BE_EXPORTED'),(2,1,'running','PRIVATE_PAYLOAD_MUST_NOT_BE_EXPORTED');`)
    }
    const preflight = await db.exec(catalog)
    const metadata = preflight.flatMap(result => result.rows).find(row => "read_only" in row)
    assert.equal(metadata.read_only, "on")
    assert.equal(metadata.migration_registry_present, false)
    assert.equal(metadata.legacy_sunbiz_index_present, false)
    pass("catalog is read-only and reports absent optional objects without mutation")
    const result = await db.exec(inventory)
    const parent = result.flatMap(item => item.rows).find(row => row.parent_and_scheduler_inventory).parent_and_scheduler_inventory
    const children = result.flatMap(item => item.rows).find(row => row.child_inventory).child_inventory
    assert.equal(parent.parent_rows_observed, 2)
    assert.equal(parent.parent_counts_complete, true)
    assert.deepEqual(parent.parent_status_counts, { failed: 1, running: 1 })
    assert.deepEqual(parent.cron_jobs, [{ name: "synthetic-job", active: true }])
    pass("small parent and scheduler metadata is complete and exact")
    assert.equal(children.sample_completeness.length, 4)
    assert.ok(children.sample_completeness.every(row => row.counts_complete && row.observed_rows === 2))
    assert.ok(children.child_states_by_parent.some(row => row.child_status === "queued" && row.parent_status === "failed"))
    assert.ok(children.child_states_by_parent.some(row => row.child_status === "running" && row.parent_status === "running"))
    pass("four child collections retain terminal versus runnable parent distinction")
    assert.ok(!JSON.stringify(result).includes("MUST_NOT_BE_EXPORTED"))
    pass("private payload and scheduler command text are excluded")
    await db.exec("insert into leadgen_poll_tasks values(2,2,'queued','private'),(9999,1,'queued','private')")
    const mismatches = (await db.exec(inventory)).flatMap(item => item.rows).find(row => row.child_inventory).child_inventory.child_states_by_parent
    assert.ok(mismatches.some(row => row.workspace_mismatch === true))
    assert.ok(mismatches.some(row => row.parent_status === "<missing parent>"))
    pass("cross-workspace and missing-parent anomalies remain visible")
    await db.exec("insert into leadgen_polls select n,1,'completed' from generate_series(3,1001) n; insert into leadgen_poll_tasks select 1,1,'queued',null from generate_series(1,9997)")
    const capped = (await db.exec(inventory)).flatMap(item => item.rows)
    const cappedParent = capped.find(row => row.parent_and_scheduler_inventory).parent_and_scheduler_inventory
    const cappedChildren = capped.find(row => row.child_inventory).child_inventory
    assert.equal(cappedParent.parent_rows_observed, 1001)
    assert.equal(cappedParent.parent_counts_complete, false)
    assert.equal(cappedChildren.sample_completeness.find(row => row.table_name === "leadgen_poll_tasks").counts_complete, false)
    pass("row-cap hits explicitly mark both parent and child counts incomplete")
    assert.equal((await db.query("select count(*)::int as n from leadgen_polls")).rows[0].n, 1001)
    assert.equal((await db.query("select count(*)::int as n from leadgen_poll_tasks")).rows[0].n, 10001)
    pass("diagnostics preserve all fixture rows")
    await assert.rejects(db.exec("begin transaction read only; insert into leadgen_polls values(99999,1,'queued'); rollback;"), error => error.code === "25006")
    await db.exec("rollback")
    pass("PostgreSQL read-only transaction rejects writes")
    console.log(`${checks}/${checks} operational inventory checks passed`)
} finally { await db.close() }
