import { createHmac, timingSafeEqual } from "node:crypto"
import { isSopId, SOP_SOURCE_ROLES, validateSopAsset, type SopSourceRole } from "./records-policy"
import type { SopFile } from "./policy"
export type SopAssetTicket = { id: string; sopId: string; workspaceId: string; userId: string; file: SopFile; role: SopSourceRole; notes: string; expires: number }
const mac = (body: string, secret: string) => createHmac("sha256", secret).update(`sop-asset-v1:${body}`).digest()
export function signSopAssetTicket(ticket: SopAssetTicket, secret: string) { const body = Buffer.from(JSON.stringify(ticket)).toString("base64url"); return `${body}.${mac(body, secret).toString("base64url")}` }
export function readSopAssetTicket(token: unknown, secret: string, workspaceId: string, userId: string, sopId: string, now = Date.now()): SopAssetTicket {
    if (typeof token !== "string" || token.length > 12000) throw new Error("Invalid upload receipt.")
    const [body, signature, extra] = token.split(".")
    const actual = Buffer.from(signature ?? "", "base64url"), expected = mac(body, secret)
    if (extra || actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error("Invalid upload receipt.")
    const ticket = JSON.parse(Buffer.from(body, "base64url").toString()) as SopAssetTicket
    if (ticket.workspaceId !== workspaceId || ticket.userId !== userId || ticket.sopId !== sopId || !isSopId(ticket.id) || !isSopId(ticket.sopId) || !Number.isFinite(ticket.expires) || ticket.expires <= now) throw new Error("This receipt expired or belongs to another SOP or account.")
    if (!SOP_SOURCE_ROLES.includes(ticket.role) || typeof ticket.notes !== "string" || ticket.notes.length > 2000) throw new Error("Invalid asset guidance.")
    return { ...ticket, file: validateSopAsset(ticket.file) }
}
export function validSopAssetHeader(type: string, bytes: Uint8Array) {
    const b = Buffer.from(bytes), ascii = b.toString("latin1")
    if (type === "application/pdf") return b.subarray(0, 1024).includes(Buffer.from("%PDF-"))
    if (type.includes("officedocument")) return b.subarray(0, 4).equals(Buffer.from([0x50,0x4b,3,4]))
    if (type === "image/png") return b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
    if (type === "image/jpeg") return b[0] === 255 && b[1] === 216 && b[2] === 255
    if (type === "image/gif") return /^GIF8[79]a/.test(ascii)
    if (type === "image/webp") return ascii.startsWith("RIFF") && ascii.slice(8,12) === "WEBP"
    if (type === "video/webm") return b.subarray(0,4).equals(Buffer.from([0x1a,0x45,0xdf,0xa3]))
    if (type === "audio/wav") return ascii.startsWith("RIFF") && ascii.slice(8,12) === "WAVE"
    if (type === "audio/mpeg") return ascii.startsWith("ID3") || (b[0] === 255 && (b[1] & 0xe0) === 0xe0)
    if (/^(video|audio)\//.test(type)) return ["ftyp","moov","mdat","wide"].includes(ascii.slice(4,8))
    if (type.startsWith("text/")) return !b.includes(0) // UTF-8/plain text only; never render as HTML.
    return false
}
