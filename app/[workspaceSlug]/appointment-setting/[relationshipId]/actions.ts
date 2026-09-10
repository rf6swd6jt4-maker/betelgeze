"use server"

import * as commands from "@/lib/appointment-setting-commands"

export type { AppointmentUpdateField } from "@/lib/appointment-setting"
export type { AppointmentSubmission } from "@/lib/appointment-setting-commands"

export async function createAppointmentSettingDraft(...args: Parameters<typeof commands.createAppointmentSettingDraft>) {
    return commands.createAppointmentSettingDraft(...args)
}

export async function updateAppointmentSettingAppointment(...args: Parameters<typeof commands.updateAppointmentSettingAppointment>) {
    return commands.updateAppointmentSettingAppointment(...args)
}

export async function saveAppointmentSettingDraft(...args: Parameters<typeof commands.saveAppointmentSettingDraft>) {
    return commands.saveAppointmentSettingDraft(...args)
}

export async function submitAppointmentSettingAppointment(...args: Parameters<typeof commands.submitAppointmentSettingAppointment>) {
    return commands.submitAppointmentSettingAppointment(...args)
}

export async function deleteAppointmentSettingAppointment(...args: Parameters<typeof commands.deleteAppointmentSettingAppointment>) {
    return commands.deleteAppointmentSettingAppointment(...args)
}
