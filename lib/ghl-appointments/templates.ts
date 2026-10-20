// Exact submitted contracts, recorded in docs/ghl-whatsapp-template-submission-2026-10-11.json.
// Approval is verified live at dispatch; these constants never imply approval.
export const appointmentTemplateContracts = {
    "added": {
        "name": "be_appointment_added",
        "id": "1415800937309351",
        "language": "en_US",
        "body": "An appointment has been added to your connected calendar.\n\nCalendar: {{1}}\nAppointment contact: {{2}}\nAppointment: {{3}}\nDate and time: {{4}}\nStatus at update: {{5}}\nContact details: {{6}}\nMeeting details: {{7}}\nBooking details: {{8}}\nUpdate recorded: {{9}}\n\nYou can view the appointment summary and latest status below.",
        "variables": [
            "calendar_name",
            "contact_name",
            "appointment_name",
            "schedule",
            "status",
            "contact_details",
            "meeting_details",
            "booking_details",
            "update_recorded_at"
        ],
        "ttlSeconds": 3600
    },
    "rescheduled": {
        "name": "be_appointment_rescheduled",
        "id": "1796403754961389",
        "language": "en_US",
        "body": "An appointment in your connected calendar has been rescheduled.\n\nCalendar: {{1}}\nAppointment contact: {{2}}\nPrevious date and time: {{3}}\nNew date and time: {{4}}\nContact details: {{5}}\nMeeting details: {{6}}\nBooking details: {{7}}\nUpdate recorded: {{8}}\n\nThe new date and time replace the previous schedule. You can view the appointment summary below.",
        "variables": [
            "calendar_name",
            "contact_name",
            "previous_schedule",
            "current_schedule",
            "contact_details",
            "meeting_details",
            "booking_details",
            "update_recorded_at"
        ],
        "ttlSeconds": 3600
    },
    "cancelled": {
        "name": "be_appointment_cancelled",
        "id": "2521941414984943",
        "language": "en_US",
        "body": "An appointment in your connected calendar has been cancelled.\n\nCalendar: {{1}}\nAppointment contact: {{2}}\nAppointment: {{3}}\nPreviously scheduled for: {{4}}\nContact details: {{5}}\nUpdate recorded: {{6}}\n\nThe recorded change is a cancellation. You can view the saved appointment details and latest status below.",
        "variables": [
            "calendar_name",
            "contact_name",
            "appointment_name",
            "previous_schedule",
            "contact_details",
            "update_recorded_at"
        ],
        "ttlSeconds": 3600
    },
    "removed": {
        "name": "be_appointment_removed",
        "id": "2622511831545035",
        "language": "en_US",
        "body": "An appointment has been removed from your connected calendar.\n\nCalendar: {{1}}\nAppointment contact: {{2}}\nAppointment: {{3}}\nPreviously scheduled for: {{4}}\nChange recorded: {{5}}\n\nYou can view the saved appointment summary below.",
        "variables": [
            "calendar_name",
            "contact_name",
            "appointment_name",
            "previous_schedule",
            "change_recorded_at"
        ],
        "ttlSeconds": 3600
    },
    "details_updated": {
        "name": "be_appointment_details_updated",
        "id": "1084971824315078",
        "language": "en_US",
        "body": "Details have changed for an appointment in your connected calendar.\n\nCalendar: {{1}}\nAppointment contact: {{2}}\nAppointment: {{3}}\nDate and time: {{4}}\nChanged details: {{5}}\nUpdate recorded: {{6}}\n\nThe changes shown above have been saved. You can view the appointment summary below.",
        "variables": [
            "calendar_name",
            "contact_name",
            "appointment_name",
            "schedule",
            "changed_details",
            "update_recorded_at"
        ],
        "ttlSeconds": 3600
    },
    "status_updated": {
        "name": "be_appointment_status_updated",
        "id": "28383522704653151",
        "language": "en_US",
        "body": "The status of an appointment in your connected calendar has changed.\n\nCalendar: {{1}}\nAppointment contact: {{2}}\nAppointment: {{3}}\nDate and time: {{4}}\nPrevious status: {{5}}\nStatus at update: {{6}}\nUpdate recorded: {{7}}\n\nYou can view the appointment summary and latest status below.",
        "variables": [
            "calendar_name",
            "contact_name",
            "appointment_name",
            "schedule",
            "previous_status",
            "current_status",
            "update_recorded_at"
        ],
        "ttlSeconds": 3600
    },
    "reminder": {
        "name": "be_appointment_reminder",
        "id": "4488234441393579",
        "language": "en_US",
        "body": "This is a reminder for an appointment in your connected calendar.\n\nCalendar: {{1}}\nAppointment contact: {{2}}\nAppointment: {{3}}\nDate and time: {{4}}\nContact details: {{5}}\nMeeting details: {{6}}\nBooking details: {{7}}\nReminder generated: {{8}}\n\nYou can view the appointment summary and latest status below.",
        "variables": [
            "calendar_name",
            "contact_name",
            "appointment_name",
            "schedule",
            "contact_details",
            "meeting_details",
            "booking_details",
            "reminder_generated_at"
        ],
        "ttlSeconds": 1800
    }
} as const

export type AppointmentTemplateKind = keyof typeof appointmentTemplateContracts
export const APPOINTMENT_SUMMARY_PREFIX = "https://portal.scaylup.com/appointment/"

type ProviderTemplate = {
    id?: string
    name?: string
    language?: string
    status?: string
    category?: string
    parameter_format?: string
    message_send_ttl_seconds?: number
    components?: Array<{ type?: string; text?: string; buttons?: Array<{ type?: string; text?: string; url?: string }> }>
}

/** Fail closed on recategorization, language fallback, edits, extra media/buttons, or TTL changes. */
export function validateAppointmentTemplate(candidate: unknown, kind: AppointmentTemplateKind) {
    const expected = appointmentTemplateContracts[kind]
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) throw new Error("Appointment template was not returned by Meta.")
    const actual = candidate as ProviderTemplate
    if (actual.id !== expected.id || actual.name !== expected.name || actual.language !== expected.language) {
        throw new Error("Appointment template identity or language does not match the submitted contract.")
    }
    if (actual.status !== "APPROVED" || actual.category !== "UTILITY") throw new Error("Appointment template must currently be approved as Utility.")
    if (actual.parameter_format && actual.parameter_format !== "POSITIONAL") throw new Error("Appointment template parameter format changed.")
    if (actual.message_send_ttl_seconds !== expected.ttlSeconds) throw new Error("Appointment template validity period changed or could not be verified.")
    const components = actual.components
    if (!Array.isArray(components) || components.length !== 2) throw new Error("Appointment template components changed.")
    const body = components.filter((component) => component.type === "BODY")
    const buttons = components.filter((component) => component.type === "BUTTONS")
    const button = buttons[0]?.buttons?.[0]
    if (body.length !== 1 || body[0].text !== expected.body || buttons.length !== 1 || buttons[0].buttons?.length !== 1
        || button?.type !== "URL" || button.text !== "View appointment" || button.url !== `${APPOINTMENT_SUMMARY_PREFIX}{{1}}`) {
        throw new Error("Appointment template copy or summary button changed.")
    }
    return expected
}

export function appointmentTemplateComponents(kind: AppointmentTemplateKind, values: Record<string, string>, summaryToken: string) {
    if (!/^[0-9a-f]{64}$/.test(summaryToken)) throw new Error("Appointment summary reference is invalid.")
    const contract = appointmentTemplateContracts[kind]
    const parameters = contract.variables.map((name) => {
        const value = values[name]
        // Reject unsupported input instead of silently dropping appointment detail.
        if (typeof value !== "string" || !value.trim() || value.length > 512 || /[\r\n\t\u0000-\u001f\u007f]/.test(value) || /\{\{|\}\}/.test(value)) {
            throw new Error(`Appointment template parameter ${name} is missing or unsupported.`)
        }
        return { type: "text", text: value.trim() }
    })
    const body = contract.body.replace(/\{\{(\d+)\}\}/g, (_, position: string) => parameters[Number(position) - 1].text)
    if (body.length > 1024) throw new Error("Appointment notification exceeds its tested maximum length.")
    return {
        body,
        components: [
            { type: "body", parameters },
            { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: summaryToken }] },
        ],
        name: contract.name,
        language: contract.language,
    }
}
