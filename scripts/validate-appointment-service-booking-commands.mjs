import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { PGlite } from "./pglite-fixture.mjs"

// Isolated SQL evidence only: real command/access functions on minimal fixture
// tables. Does not send messages, exercise encryption, or contact a provider.
const db = new PGlite()
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`
const [workspace, relationship, service, revision, instance, owner, recipient, former, outsider, appointment] = Array.from({ length: 10 }, (_, n) => uuid(n + 1))
const migration = name => readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8")
const q = async (sql, params = []) => (await db.query(sql, params)).rows
const one = async (sql, params = []) => (await q(sql, params))[0]
const pass = label => console.log(`PASS ${label}`)
try {
    await db.exec(`
        create role anon; create role authenticated; create role service_role bypassrls;
        create schema auth;
        create table auth.users(id uuid primary key);
        create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
        create table workspaces(id uuid primary key, status text default 'active');
        create table workspace_memberships(workspace_id uuid,user_id uuid,role text,primary key(workspace_id,user_id));
        create table relationships(id uuid primary key,workspace_id uuid,status text default 'active',lifecycle_phase text,client_id uuid,unique(workspace_id,id));
        create table onboarding_services(id uuid primary key,workspace_id uuid,state text default 'active');
        create table onboarding_service_revisions(id uuid primary key,workspace_id uuid,definition jsonb);
        create table relationship_service_instances(id uuid primary key,workspace_id uuid,relationship_id uuid,service_id uuid,service_revision_id uuid,assignee_user_id uuid,stage text,disposition text default 'active',import_id uuid,created_at timestamptz default now());
        create table relationship_services(workspace_id uuid,relationship_id uuid,service_id uuid,service_revision_id uuid,assignee_user_id uuid,created_at timestamptz default now());
        create table workspace_member_service_access(workspace_id uuid,user_id uuid,service_id uuid);
        create table workspace_service_capabilities(workspace_id uuid,service_id uuid,capability text);
        create function workspace_role_for_user(w uuid,u uuid) returns text language sql stable as $$ select role from workspace_memberships where workspace_id=w and user_id=u $$;
        create table appointment_setting_appointments(
            id uuid primary key,workspace_id uuid,relationship_id uuid,service_id uuid,
            updated_at timestamptz default now(),workflow_status text default 'draft',
            contact_name text,phone text,appointment_date date,appointment_time time,
            appointment_timezone text default 'UTC',meeting_medium text default 'phone',
            meeting_link text,details text,updated_by uuid,appointment_at timestamptz,
            submitted_at timestamptz,submitted_by uuid,submission_message_id uuid
        );
        create table client_messages(
            id uuid primary key default gen_random_uuid(), workspace_id uuid,relationship_id uuid,
            client_id uuid,communication_channel_id uuid,direction text,provider text,to_address text,
            body text,status text,sender_kind text,automation_kind text,automation_label text,
            client_request_id uuid,raw_payload jsonb,error text
        );
        insert into workspaces values('${workspace}','active');
        insert into auth.users values('${owner}'),('${recipient}'),('${former}'),('${outsider}');
        insert into workspace_memberships values('${workspace}','${owner}','owner'),('${workspace}','${recipient}','staff'),('${workspace}','${former}','staff'),('${workspace}','${outsider}','staff');
        insert into relationships values('${relationship}','${workspace}','active','fulfilment',null);
        insert into onboarding_services values('${service}','${workspace}','active');
        insert into onboarding_service_revisions values('${revision}','${workspace}','{"templateId":"appointment-setting"}');
        insert into relationship_service_instances values('${instance}','${workspace}','${relationship}','${service}','${revision}','${recipient}','setup','active',null);
        insert into relationship_services values('${workspace}','${relationship}','${service}','${revision}','${former}');
        insert into workspace_member_service_access values('${workspace}','${recipient}','${service}'),('${workspace}','${former}','${service}'),('${workspace}','${outsider}','${service}');
        insert into workspace_service_capabilities values('${workspace}','${service}','appointment_setting.manage');
        insert into appointment_setting_appointments(id,workspace_id,relationship_id,service_id,contact_name,phone,appointment_date,appointment_time)
        values('${appointment}','${workspace}','${relationship}','${service}','Example contact','+15550000000','2026-10-06','10:00');
    `)
    const accessSql = await migration("20261005220000_service_assignee_transfer.sql")
    await db.exec(accessSql.slice(accessSql.indexOf("create function public.current_appointment_service_assignments("), accessSql.indexOf("create function public.service_assignee_can_setup_client(")))
    await db.exec(accessSql.slice(accessSql.indexOf("create function public.read_assigned_appointment_services("), accessSql.indexOf("-- Preserve the existing list projection")))
    await db.exec(await migration("20260910150000_appointment_draft_command_receipts.sql"))
    const submitSql = await migration("20260909230000_retention_creator_portal_handoff.sql")
    const start = submitSql.indexOf("create or replace function public.submit_appointment_setting_appointment(")
    await db.exec(submitSql.slice(start, submitSql.indexOf("\n$$;", start) + 4))
    await db.exec(await migration("20260910210000_appointment_notification_outbox.sql"))
    await db.exec("grant usage on schema public,auth to service_role; grant all on all tables in schema public to service_role;")
    const signatures = ["save_appointment_setting_draft_command(uuid,uuid,uuid,uuid,uuid,timestamptz,uuid,text,jsonb)", "submit_appointment_setting_appointment(uuid,uuid,uuid,uuid,uuid,timestamptz,uuid,text,text,text)"]
    const definitions = async () => Promise.all(signatures.map(async name => (await one("select pg_get_functiondef($1::regprocedure) definition", [name])).definition))
    const baseline = await definitions()
    // Serialize server versions as text so JavaScript does not round microseconds.
    const version = async () => (await one("select updated_at::text version from appointment_setting_appointments where id=$1", [appointment])).version
    const save = async (actor, expected, request = uuid(20), hash = "a".repeat(64), changes = { details: "Prepared by the current assignee" }) => (await one("select save_appointment_setting_draft_command($1,$2,$3,$4,$5,$6,$7,$8,$9) result", [workspace, relationship, service, appointment, actor, expected, request, hash, changes])).result
    const submit = async (actor, expected) => (await one("select submit_appointment_setting_appointment_queued($1,$2,$3,$4,$5,$6,null,'client_portal','portal:fixture','New appointment') result", [workspace, relationship, service, appointment, actor, expected])).result
    await db.exec("set role service_role")
    const originalVersion = await version()
    assert.equal((await one("select workspace_user_can_manage_appointment_setting($1,$2,$3,$4) allowed", [workspace, relationship, service, recipient])).allowed, true)
    await assert.rejects(save(recipient, originalVersion), /Appointment Setting access is required/)
    await assert.rejects(submit(recipient, originalVersion), /Relationship not found/)
    assert.equal((await one("select count(*)::int n from client_messages")).n, 0)
    pass("baseline reproduces Setup booking failures despite current service authorization")

    await db.exec("reset role")
    await db.exec(await migration("20261005220500_appointment_service_booking_commands.sql"))
    const candidate = await definitions()
    assert.equal(candidate[0], baseline[0].replace(" and lifecycle_phase = 'retention'", ""))
    assert.equal(candidate[1], baseline[1].replace(" and relationship.lifecycle_phase = 'retention'", ""))
    pass("migration changes only obsolete lifecycle clauses, preserving latest submit and receipt definitions")

    await db.exec("set role service_role")
    await assert.rejects(save(former, originalVersion), /Appointment Setting access is required/)
    await assert.rejects(save(outsider, originalVersion), /Appointment Setting access is required/)
    await assert.rejects(submit(former, originalVersion), /Appointment Setting access is required/)
    await assert.rejects(submit(outsider, originalVersion), /Appointment Setting access is required/)
    const saved = await save(recipient, originalVersion)
    assert.equal(saved.replayed, false)
    assert.equal((await save(recipient, originalVersion)).replayed, true)
    await assert.rejects(save(recipient, originalVersion, uuid(20), "b".repeat(64)), /reused for different/)
    await assert.rejects(save(recipient, originalVersion, uuid(21)), /draft changed/)
    const submitted = await submit(recipient, await version())
    assert.equal(submitted.already_submitted, false)
    const replay = await submit(recipient, originalVersion)
    assert.equal(replay.already_submitted, true)
    assert.equal(replay.message_id, submitted.message_id)
    assert.equal(replay.outbox_id, submitted.outbox_id)
    assert.equal((await one("select count(*)::int n from client_messages")).n, 1)
    assert.equal((await one("select count(*)::int n from appointment_notification_outbox")).n, 1)
    pass("current Setup assignee saves and submits; former/unassigned staff denied; retries create one receipt/message/outbox")

    // Reset only fixture data for the remaining authorization matrix.
    await q("update appointment_setting_appointments set workflow_status='draft',submission_message_id=null where id=$1", [appointment])
    await q("update relationship_service_instances set stage='onboarding' where id=$1", [instance])
    await assert.rejects(save(recipient, await version(), uuid(22)), /Appointment Setting access is required/)
    await q("update relationship_service_instances set stage='maintenance' where id=$1", [instance])
    assert.equal((await save(owner, await version(), uuid(23))).replayed, false)
    await q("update relationship_service_instances set assignee_user_id=$1 where id=$2", [former, instance])
    await assert.rejects(save(recipient, await version(), uuid(24)), /Appointment Setting access is required/)
    assert.equal((await save(former, await version(), uuid(25))).replayed, false)
    await q("update relationships set status='archived' where id=$1", [relationship])
    await assert.rejects(save(former, await version(), uuid(26)), /Appointment Setting access is required/)
    await q("update relationships set status='active',lifecycle_phase='retention' where id=$1", [relationship])
    await q("delete from relationship_service_instances where id=$1", [instance])
    assert.equal((await save(former, await version(), uuid(27))).replayed, false)
    await q("update relationships set lifecycle_phase='fulfilment' where id=$1", [relationship])
    await assert.rejects(save(former, await version(), uuid(28)), /Appointment Setting access is required/)
    pass("onboarding/archive denial, owner Maintenance access, current reassignment, and legacy Retention-only access remain")
    await q("update relationships set lifecycle_phase='retention' where id=$1", [relationship])
    await q("insert into relationship_service_instances values($1,$2,$3,$4,$5,$6,'negotiating','active',null)",[instance,workspace,relationship,service,revision,recipient])
    for (const stage of ['negotiating','declined','for_later','awaiting_payment']) {
        await q('update relationship_service_instances set stage=$1 where id=$2',[stage,instance])
        assert.equal((await one('select workspace_user_can_manage_appointment_setting($1,$2,$3,$4) allowed',[workspace,relationship,service,former])).allowed,true)
        assert.equal((await one('select workspace_user_can_manage_appointment_setting($1,$2,$3,$4) allowed',[workspace,relationship,service,recipient])).allowed,false)
    }
    for (const [stage,disposition] of [['onboarding','active'],['setup','cancelled'],['maintenance','paused'],['completed','active']]) {
        await q('update relationship_service_instances set stage=$1,disposition=$2 where id=$3',[stage,disposition,instance])
        assert.equal((await one('select workspace_user_can_manage_appointment_setting($1,$2,$3,$4) allowed',[workspace,relationship,service,former])).allowed,false)
    }
    pass('tentative opportunities preserve legacy bookings; delivery instances prevent stale legacy access after closure')

    // Reverse UUID and creation order so the reader cannot silently switch the
    // service whose existing appointment history/configuration the API opens.
    const multiRelationship = uuid(900), oldest = uuid(990), later = uuid(980), currentOldest = uuid(970), currentLater = uuid(960), denied = uuid(950)
    await q("insert into relationships values($1,$2,'active','retention',null)", [multiRelationship, workspace])
    for (const candidateService of [oldest,later,currentOldest,currentLater,denied]) {
        await q("insert into onboarding_services values($1,$2,'active')", [candidateService, workspace])
        await q("insert into onboarding_service_revisions values($1,$2,'{\"templateId\":\"appointment-setting\"}')", [candidateService, workspace])
        await q("insert into workspace_member_service_access values($1,$2,$3)", [workspace, recipient, candidateService])
        await q("insert into workspace_service_capabilities values($1,$2,'appointment_setting.manage')", [workspace, candidateService])
    }
    for (const [candidateService, actor, created] of [[oldest,recipient,'2026-01-01'],[later,recipient,'2026-02-01'],[denied,outsider,'2025-01-01']]) {
        await q("insert into relationship_services values($1,$2,$3,$3,$4,$5)", [workspace, multiRelationship, candidateService, actor, created])
    }
    for (const [candidateService, created] of [[currentOldest,'2024-01-01'],[currentLater,'2026-03-01']]) {
        await q("insert into relationship_service_instances values($1,$2,$3,$4,$4,$5,'setup','active',null,$6)", [uuid(Number(candidateService.slice(-3))+1000), workspace, multiRelationship, candidateService, recipient, created])
    }
    const selected = async actor => (await one("select read_assigned_appointment_services($1,$2,$3) items", [workspace, actor, multiRelationship])).items.map(item => item.service_id)
    assert.deepEqual(await selected(recipient), [oldest,later,currentLater,currentOldest])
    assert.deepEqual(await selected(owner), [denied,oldest,later,currentLater,currentOldest])
    await q("delete from workspace_member_service_access where workspace_id=$1 and user_id=$2 and service_id=$3", [workspace,recipient,oldest])
    assert.deepEqual(await selected(recipient), [later,currentLater,currentOldest])
    await q("delete from relationship_services where workspace_id=$1 and relationship_id=$2", [workspace,multiRelationship])
    assert.deepEqual(await selected(recipient), [currentLater,currentOldest])
    pass('multiple services retain oldest authorized legacy selection before deterministic current-instance fallback')
} finally {
    await db.close()
}
