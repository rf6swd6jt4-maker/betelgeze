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

export function formatMetaWhatsAppDeliveryError(error?: {
    title?: string
    message?: string
    code?: number
    error_data?: { details?: string }
}) {
    if (!error) return null
    if (error.code === 131049) return "WhatsApp blocked this template under its marketing delivery restrictions (Meta 131049). Check the confirmation template’s category in Settings; retrying the same template may fail again."
    return [...new Set([error.title, error.message, error.error_data?.details].filter(Boolean)), error.code ? `Meta code ${error.code}` : null].filter(Boolean).join(": ")
}
