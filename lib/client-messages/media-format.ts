function titleCase(value: string) {
    return value.charAt(0).toUpperCase() + value.slice(1)
}

export function formatMediaMessageForClickUp({
    type,
    url,
    caption,
}: {
    type: string
    url: string
    caption?: string
}) {
    const mediaName = titleCase(type)
    const preview =
        type === "image" || type === "sticker"
            ? [`![${mediaName}](${url})`, "", `[Open ${type}](${url})`]
            : [`${mediaName}: [Open ${type}](${url})`]
    const captionLines = caption?.trim() ? ["", caption.trim()] : []

    return [...preview, ...captionLines].join("\n")
}
