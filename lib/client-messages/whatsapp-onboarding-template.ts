type Template = {
    name?: string
    language?: string
    status?: string
    category?: string
    components?: Array<{ type?: string; format?: string; text?: string; buttons?: Array<{ type?: string; url?: string }> }>
}

export type WhatsAppOnboardingTemplate = {
    name: string
    language: string
    linkParameter: { location: "body" } | { location: "url_button"; index: number; prefix: string }
}

function placeholders(value: string) {
    return value.match(/\{\{\d+\}\}/g) ?? []
}

export function validateWhatsAppOnboardingTemplate(templates: unknown, name: string, language: string): WhatsAppOnboardingTemplate {
    const named = (Array.isArray(templates) ? templates : []).filter((item: Template) => item.name === name) as Template[]
    const exact = named.find((item) => item.language === language)
    const template = exact ?? (named.length === 1 ? named[0] : undefined)
    if (!template) {
        const available = named.flatMap((item) => typeof item.language === "string" ? [item.language] : [])
        throw new Error(available.length
            ? `The ${name} template is not available in ${language}. Available: ${available.join(", ")}.`
            : `The ${name} WhatsApp onboarding Utility template was not found.`)
    }
    if (template.status !== "APPROVED" || template.category !== "UTILITY") throw new Error(`The ${name} WhatsApp onboarding Utility template must be approved before selling.`)
    if (!template.language) throw new Error(`The ${name} template did not provide a language code.`)
    const components = template.components ?? []
    const body = components.find((item) => item.type === "BODY")?.text ?? ""
    const buttons = components.flatMap((item) => item.type === "BUTTONS" ? item.buttons ?? [] : [])
    const bodyVariables = placeholders(body)
    const parameterizedButtons = buttons.flatMap((button, index) => {
        const url = button.url ?? ""
        return placeholders(url).length ? [{ button, index, url }] : []
    })
    const invalidHeader = components.some((item) => item.type === "HEADER" && (item.format !== "TEXT" || placeholders(item.text ?? "").length > 0))
    const validBodyLink = bodyVariables.length === 1 && bodyVariables[0] === "{{1}}" && parameterizedButtons.length === 0
    const urlButton = parameterizedButtons.length === 1 ? parameterizedButtons[0] : null
    const validButtonLink = bodyVariables.length === 0
        && urlButton?.button.type === "URL"
        && placeholders(urlButton.url).length === 1
        && urlButton.url.endsWith("{{1}}")
    if (invalidHeader || (!validBodyLink && !validButtonLink)) {
        throw new Error(`The ${name} template must contain exactly one secure-link variable in its body or URL button, with no other variables or media header.`)
    }
    return {
        name,
        language: template.language,
        linkParameter: validBodyLink
            ? { location: "body" }
            : { location: "url_button", index: urlButton!.index, prefix: urlButton!.url.slice(0, -"{{1}}".length) },
    }
}

export function whatsappOnboardingTemplateComponents(template: WhatsAppOnboardingTemplate, onboardingUrl: string) {
    if (template.linkParameter.location === "body") {
        return [{ type: "body", parameters: [{ type: "text", text: onboardingUrl }] }]
    }
    if (!onboardingUrl.startsWith(template.linkParameter.prefix)) {
        throw new Error("The onboarding URL does not match the approved WhatsApp template's URL button.")
    }
    const suffix = onboardingUrl.slice(template.linkParameter.prefix.length)
    if (!suffix) throw new Error("The onboarding URL is missing the secure URL-button value.")
    return [{
        type: "button",
        sub_type: "url",
        index: String(template.linkParameter.index),
        parameters: [{ type: "text", text: suffix }],
    }]
}
