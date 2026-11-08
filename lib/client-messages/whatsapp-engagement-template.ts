type Template = {
    name?: string
    language?: string
    status?: string
    category?: string
    components?: Array<{ type?: string; format?: string; text?: string; buttons?: Array<{ type?: string; text?: string }> }>
}

export type WhatsAppEngagementTemplate = {
    name: string
    language: string
    bodyVariableCount: number
}

function placeholders(value: string) {
    return value.match(/\{\{\d+\}\}/g) ?? []
}

/**
 * Validates a staff-triggered, free-text-variable Utility template (e.g. a call
 * request or report-ready nudge) — distinct from `validateWhatsAppConsentTemplate`
 * (no variables allowed) and `validateWhatsAppLinkTemplate` (exactly one secure-link
 * variable). These templates carry one or more plain-text variables and a single
 * quick-reply button that reopens the conversation window on reply.
 */
export function validateWhatsAppEngagementTemplate(templates: unknown, name: string, language: string, purpose: string): WhatsAppEngagementTemplate {
    const template = (Array.isArray(templates) ? templates : []).find((item: Template) => item.name === name && item.language === language) as Template | undefined
    if (!template || template.status !== "APPROVED") throw new Error(`The WhatsApp ${purpose} template ${name} is not approved for ${language}.`)
    if (template.category !== "UTILITY") throw new Error(`The WhatsApp ${purpose} template ${name} is ${template.category || "unclassified"}. Select an approved Utility template in Settings; Marketing templates can be blocked for clients, including US numbers.`)
    const components = template.components ?? []
    if (components.some((component) => component.type === "HEADER")) throw new Error(`Use a ${purpose} template with no header; this flow does not support media or text headers.`)
    const body = components.find((component) => component.type === "BODY")?.text
    if (!body) throw new Error(`The WhatsApp ${purpose} template must contain a text body.`)
    const variables = placeholders(body)
    const sequential = variables.every((token, index) => token === `{{${index + 1}}}`)
    if (!variables.length || !sequential) throw new Error(`The WhatsApp ${purpose} template body must use sequential {{1}}, {{2}}… variables with no gaps or repeats.`)
    const buttons = components.flatMap((component) => component.buttons ?? [])
    if (buttons.length !== 1 || buttons[0].type !== "QUICK_REPLY") throw new Error(`Use a ${purpose} template with exactly one quick-reply button, not a URL or calling-permission button.`)
    return { name, language, bodyVariableCount: variables.length }
}
