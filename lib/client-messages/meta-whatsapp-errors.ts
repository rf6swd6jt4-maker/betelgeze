type MetaWhatsAppApiError = {
    error?: {
        message?: string
        code?: number
        type?: string
        error_subcode?: number
    }
}

function getMetaWhatsAppAuthHelp() {
    return [
        "Meta rejected META_WHATSAPP_ACCESS_TOKEN.",
        "Update the Vercel env var with a valid permanent/system-user token",
        "that has WhatsApp Business Platform access to this phone number,",
        "then redeploy.",
    ].join(" ")
}

export function formatMetaWhatsAppApiError({
    action,
    status,
    responseBody,
}: {
    action: string
    status: number
    responseBody: string
}) {
    let parsed: MetaWhatsAppApiError | null = null

    try {
        parsed = responseBody ? JSON.parse(responseBody) : null
    } catch {
        parsed = null
    }

    const metaError = parsed?.error
    const metaMessage = metaError?.message ?? responseBody
    const metaCode = metaError?.code
    const metaType = metaError?.type
    const authHelp =
        status === 401 || metaCode === 190 ? ` ${getMetaWhatsAppAuthHelp()}` : ""

    return [
        `${action} failed with ${status}`,
        metaCode ? `Meta code ${metaCode}` : null,
        metaType ? metaType : null,
        metaMessage ? metaMessage : null,
    ]
        .filter(Boolean)
        .join(": ")
        .concat(authHelp)
}
