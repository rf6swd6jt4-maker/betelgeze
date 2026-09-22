import assert from "node:assert/strict"
import test from "node:test"
import { formatAppointmentOnboardingResponse } from "../lib/appointment-setting.ts"

test("appointment onboarding block responses become staff-facing answers", () => {
    assert.deepEqual(formatAppointmentOnboardingResponse({
        kind: "appointment_medium_configured",
        response: { mediums: ["phone"] },
    }), [{
        key: "mediums",
        label: "Appointment types",
        value: "Phone call",
    }])

    assert.deepEqual(formatAppointmentOnboardingResponse({
        kind: "appointment_fields_configured",
        response: { fields: [
            { key: "phone", required: true },
            { key: "email", required: false },
            { key: "service", required: true },
            { key: "address", required: true },
        ] },
        options: ["phone", "email", "service", "address", "notes"],
    }).map(({ label, value }) => ({ label, value })), [
        { label: "Phone number", value: "Required" },
        { label: "Email address", value: "Optional" },
        { label: "Service requested", value: "Required" },
        { label: "Property address", value: "Required" },
        { label: "Setter notes", value: "Not included" },
    ])
})
