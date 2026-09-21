type Template = { name?: string; language?: string; status?: string; category?: string; components?: Array<{ type?: string; format?: string; text?: string; buttons?: Array<{ url?: string }> }> }

export function validateWhatsAppOnboardingTemplate(templates: unknown, name: string, language: string) {
    const template = (Array.isArray(templates) ? templates : []).find((item: Template) => item.name === name && item.language === language) as Template | undefined
    if (template?.status !== "APPROVED" || template.category !== "UTILITY") throw new Error(`The ${name} WhatsApp onboarding Utility template must be approved before selling.`)
    const components = template.components ?? []
    const body = components.find((item) => item.type === "BODY")?.text ?? ""
    if ((body.match(/\{\{\d+\}\}/g) ?? []).join(",") !== "{{1}}" || components.some((item) => item.type === "HEADER" && (item.format !== "TEXT" || /\{\{/.test(item.text ?? ""))) || components.some((item) => item.buttons?.some((button) => /\{\{/.test(button.url ?? "")))) throw new Error(`The ${name} template must contain exactly one body variable for the secure onboarding URL and no other variables or media header.`)
    return { name, language }
}
