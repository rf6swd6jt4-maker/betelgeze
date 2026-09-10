import sharp from "sharp"

/** Called while inbound bytes are available, before a message is published. */
export async function prepareStoredCommunicationImage(bytes: Uint8Array, contentType: string) {
    if (!/^image\/(jpeg|png|webp|gif|avif|bmp)$/.test(contentType.toLowerCase().split(";", 1)[0].trim()) || bytes.byteLength > 20 * 1024 * 1024) return null
    try {
        const image = sharp(bytes, { limitInputPixels: 40_000_000 })
        const metadata = await image.metadata()
        const rotated = Boolean(metadata.orientation && metadata.orientation >= 5)
        const width = rotated ? metadata.height : metadata.width
        const height = rotated ? metadata.width : metadata.height
        if ((metadata.pages ?? 1) > 1) return { width, height, preview: null }
        const preview = await image.rotate().resize({ width: 960, height: 960, fit: "inside", withoutEnlargement: true }).webp({ quality: 78 }).timeout({ seconds: 5 }).toBuffer()
        return { width, height, preview }
    } catch { return null }
}
