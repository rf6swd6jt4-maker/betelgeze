import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import {
    appointmentSettingDetailHref,
    filterAppointmentSettingRelationships,
    formatAppointmentNotification,
    formatUsPhone,
    normalizeAppointmentMediums,
    normalizeAppointmentRequestedFields,
} from "../lib/appointment-setting.ts"
import type { RelationshipRecord } from "../lib/relationships.ts"

function relationship(id: string, lifecyclePhase: RelationshipRecord["lifecycle_phase"], status: RelationshipRecord["status"] = "active") {
    return { id, lifecycle_phase: lifecyclePhase, status } as RelationshipRecord
}

test("Appointment Setting includes only visible, non-archived Retention relationships", () => {
    const relationships = [
        relationship("retention-allowed", "retention"),
        relationship("retention-unassigned", "retention"),
        relationship("retention-archived", "retention", "archived"),
        relationship("fulfilment-allowed", "fulfilment"),
    ]

    assert.deepEqual(
        filterAppointmentSettingRelationships(
            relationships,
            new Set(["retention-allowed", "retention-archived", "fulfilment-allowed"]),
            new Set(["retention-allowed", "retention-unassigned", "retention-archived", "fulfilment-allowed"]),
        ).map((item) => item.id),
        ["retention-allowed"],
    )
    assert.deepEqual(
        filterAppointmentSettingRelationships(relationships, null, new Set(["retention-allowed"])).map((item) => item.id),
        ["retention-allowed"],
    )
})

test("Appointment Setting opens the relationship's dedicated appointment table", () => {
    const source = readFileSync("app/[workspaceSlug]/appointment-setting/page.tsx", "utf8")
    const detail = readFileSync("app/[workspaceSlug]/appointment-setting/[relationshipId]/page.tsx", "utf8")

    assert.match(source, /<List ariaLabel="Relationships ready for appointment setting">/)
    assert.match(source, /<RelationshipStage phase="retention"/)
    assert.match(source, /<Status label="Ready" tone="green"/)
    assert.match(source, /accessibleRelationshipIds\(access\)/)
    assert.match(source, /loadAppointmentSettingRelationshipServices\(access\)/)
    assert.equal(appointmentSettingDetailHref("acme", "relationship-1"), "/acme/appointment-setting/relationship-1")
    assert.match(detail, /<DetailPageHeader/)
    assert.match(detail, /<AppointmentTable/)
    assert.match(detail, /loadAppointmentSettingRelationshipService\(access, relationshipId\)/)
})

test("Appointment Setting appointments are relationship and service scoped with secure realtime reads", () => {
    const migration = readFileSync("supabase/migrations/20260903220000_appointment_setting_appointments.sql", "utf8")
    const actions = readFileSync("app/[workspaceSlug]/appointment-setting/[relationshipId]/actions.ts", "utf8")
    const table = readFileSync("components/appointment-setting/AppointmentTable.tsx", "utf8")

    assert.match(migration, /create table if not exists public\.appointment_setting_appointments/)
    assert.match(migration, /relationship_id uuid not null/)
    assert.match(migration, /service_id uuid not null/)
    assert.match(migration, /contact_name text not null/)
    assert.match(migration, /phone text not null/)
    assert.match(migration, /appointment_at timestamptz not null/)
    assert.match(migration, /workspace_user_can_manage_appointment_setting/)
    assert.match(migration, /capability\.capability = 'appointment_setting\.manage'/)
    assert.match(migration, /alter publication supabase_realtime add table public\.appointment_setting_appointments/)
    assert.match(actions, /requireWorkspacePanel\(workspaceSlug, "appointment-setting"\)/)
    assert.match(actions, /loadAppointmentSettingRelationshipService\(context\.access, relationshipId\)/)
    assert.match(table, /\.on\("postgres_changes"/)
    assert.match(table, /updateAppointmentSettingAppointment/)
})

test("Appointment Setting onboarding config drives table fields and remote links", () => {
    const migration = readFileSync("supabase/migrations/20260904090000_appointment_setting_onboarding_configuration.sql", "utf8")
    const table = readFileSync("components/appointment-setting/AppointmentTable.tsx", "utf8")
    const actions = readFileSync("app/[workspaceSlug]/appointment-setting/[relationshipId]/actions.ts", "utf8")

    assert.deepEqual(normalizeAppointmentMediums(["phone", "zoom", "invalid", "zoom"]), ["phone", "zoom"])
    assert.deepEqual(normalizeAppointmentRequestedFields([{ key: "email", required: true }, { key: "notes", required: false }]), [{ key: "email", required: true }, { key: "notes", required: false }])
    assert.equal(formatUsPhone("+1 214 555 0199"), "(214) 555-0199")
    assert.equal(formatUsPhone("123"), null)
    assert.match(migration, /relationship_appointment_setting_configs/)
    assert.match(migration, /appointment_medium_configured/)
    assert.match(migration, /appointment_fields_configured/)
    assert.match(migration, /meeting_medium = 'phone' or meeting_link is not null/)
    assert.match(table, /saveField\(appointment, "appointment_date", value\)/)
    assert.match(table, /saveField\(appointment, "appointment_time", value\)/)
    assert.match(table, /configuration\.fields\.map/)
    assert.match(actions, /formatUsPhone/)
    assert.match(actions, /Add a valid HTTPS meeting link/)
})

test("Appointment Setting drafts submit once and create an automated Communications message", () => {
    const migration = readFileSync("supabase/migrations/20260907140000_appointment_setting_drafts_and_submission.sql", "utf8")
    const table = readFileSync("components/appointment-setting/AppointmentTable.tsx", "utf8")
    const actions = readFileSync("app/[workspaceSlug]/appointment-setting/[relationshipId]/actions.ts", "utf8")

    assert.match(migration, /workflow_status text not null default 'draft'/)
    assert.match(migration, /alter column contact_name drop not null/)
    assert.match(migration, /alter column appointment_at drop not null/)
    assert.match(migration, /create or replace function public\.submit_appointment_setting_appointment/)
    assert.match(migration, /client_request_id, raw_payload/)
    assert.match(migration, /'appointment_submitted', 'New appointment'/)
    assert.match(table, /createAppointmentSettingDraft/)
    assert.match(table, /"Submitting…" : "Submit"/)
    assert.match(table, /<Status label="Submitted" tone="green"/)
    assert.match(actions, /sendCommunicationDeliveries/)
    assert.match(migration, /sender_kind/u)

    assert.equal(formatAppointmentNotification({
        contactName: "Jamie Smith",
        appointmentDate: "2026-09-08",
        appointmentTime: "14:30",
        appointmentTimezone: "America/Chicago",
        meetingMedium: "google_meet",
        meetingLink: "https://meet.google.com/example",
    }), [
        "A new appointment has been booked.",
        "",
        "Lead: Jamie Smith",
        "Date: September 8, 2026",
        "Time: 2:30 PM (America/Chicago)",
        "Medium: Google Meet",
        "Meeting link: https://meet.google.com/example",
    ].join("\n"))
})
