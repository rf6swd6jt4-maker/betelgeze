type Template = {
    name?: string
    language?: string
    status?: string
    category?: string
    components?: Array<{ type?: string; format?: string; text?: string; buttons?: Array<{ type?: string; text?: string }> }>
}

export function validateWhatsAppConsentTemplate(templates: unknown, name: string, language: string) {
    const template = (Array.isArray(templates) ? templates : []).find((item: Template) => item.name === name && item.language === language) as Template | undefined
    if (!template || template.status !== "APPROVED") throw new Error(`The WhatsApp confirmation template ${name} is not approved for ${language}.`)
    if (template.category !== "UTILITY") throw new Error(`The WhatsApp confirmation template ${name} is ${template.category || "unclassified"}. Select an approved Utility template in Settings; Marketing templates can be blocked for clients, including US numbers.`)
    const components = template.components ?? []
    const body = components.find((component) => component.type === "BODY")?.text
    if (!body || components.some((component) => /\{\{/.test(component.text ?? "") || (component.type === "HEADER" && component.format !== "TEXT"))) {
        throw new Error("Use a confirmation template with a text body and no variables or media headers.")
    }
    const buttons = components.flatMap((component) => component.buttons ?? [])
    if (buttons.some((button) => button.type !== "QUICK_REPLY")) throw new Error("Use a messaging confirmation template with quick replies, not a calling-permission or link template.")
    if (!buttons.some((button) => button.text?.trim().toUpperCase() === "CONFIRM") && !/\bCONFIRM\b/.test(body)) {
        throw new Error("The confirmation template must include a CONFIRM quick reply or ask the client to reply CONFIRM.")
    }
    return { name, language, body, category: "UTILITY" as const }
}
