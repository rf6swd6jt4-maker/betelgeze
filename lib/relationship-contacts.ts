export type MessagingMethod = "meta_whatsapp" | "twilio_sms"
export type MessagingChoice = {
    provider: MessagingMethod; address: string; added: boolean; enabled: boolean;
    state: "active" | "inactive" | "broken"; confirmedAt: string | null;
    confirmationStatus: string | null; optedIn: boolean; canSend: boolean
}
export type RelationshipContacts = {
    choices: MessagingChoice[];
    portal: { createdAt: string; active: boolean; url: string | null } | null
}
export const contactMethodName = (provider: string) => provider === "meta_whatsapp" ? "WhatsApp" : provider === "twilio_sms" ? "Twilio SMS" : provider === "email" ? "Email" : provider === "phone" ? "Phone" : "Client portal"
