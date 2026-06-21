import nodemailer from "nodemailer"

function getSmtpEnv(name: string) { const value = process.env[name]?.trim(); if (!value) throw new Error(`Missing ${name}`); return value }

export async function sendWorkspaceInvitation({ to, workspaceName, inviteUrl }: { to: string; workspaceName: string; inviteUrl: string }) {
    const transporter = nodemailer.createTransport({ host: getSmtpEnv("SMTP_HOST"), port: Number(process.env.SMTP_PORT ?? "587"), secure: process.env.SMTP_SECURE === "true", auth: { user: getSmtpEnv("SMTP_USER"), pass: getSmtpEnv("SMTP_PASSWORD") } })
    await transporter.sendMail({ from: process.env.SMTP_FROM ?? "Betelgeze <noreply@betelgeze.com>", to, subject: `You’re invited to ${workspaceName} on Betelgeze`, text: `You have been invited to ${workspaceName} on Betelgeze. Open your invitation: ${inviteUrl}`, html: `<p>You have been invited to <strong>${workspaceName}</strong> on Betelgeze.</p><p><a href="${inviteUrl}">Open your invitation</a></p><p>This invitation expires in seven days.</p>` })
}
