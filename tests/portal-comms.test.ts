import assert from "node:assert/strict"
import test from "node:test"
import { resourceUploadAssetId } from "../lib/communications/resource-upload.ts"
import { formatAppointmentNotification } from "../lib/appointment-setting.ts"

test("upload asset actions accept only structured portal events and UUIDs", () => {
    const event = { source: "client_portal", kind: "resource_upload", asset_id: "00000000-0000-4000-8000-000000000001" }
    assert.equal(resourceUploadAssetId(event), event.asset_id)
    for (const invalid of [null, [], {}, { ...event, source: "whatsapp" }, { ...event, kind: "message" }, { ...event, asset_id: "../../settings" }, { ...event, asset_id: "https://evil.example" }]) {
        assert.equal(resourceUploadAssetId(invalid), null)
    }
})

test("appointment notifications include the active portal link and preserve details without one", () => {
    const appointment = { contactName: "Test lead", appointmentDate: "2026-09-10", appointmentTime: "14:00", appointmentTimezone: "Europe/Dublin", meetingMedium: "phone" as const }
    const body = formatAppointmentNotification({ ...appointment, clientPortalUrl: "https://portal.example/session" })
    assert.match(body, /Check your client portal: https:\/\/portal.example\/session/)
    assert.match(body, /Lead: Test lead/)
    const fallback = formatAppointmentNotification({ ...appointment, clientPortalUrl: null })
    assert.match(fallback, /Time: 2:00 PM/)
    assert.doesNotMatch(fallback, /null|undefined|Check your client portal/)
})
