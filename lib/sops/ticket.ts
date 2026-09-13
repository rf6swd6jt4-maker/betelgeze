import { createHmac, timingSafeEqual } from "node:crypto"
import { validateSopFile, type SopFile } from "./policy"
export type SopTicket = { id: string; workspaceId: string; userId: string; file: SopFile; expires: number }
function signature(body: string, secret: string) { return createHmac("sha256", secret).update(`sop-upload-v1:${body}`).digest() }
export function signSopTicket(ticket: SopTicket, secret: string) {
    const body = Buffer.from(JSON.stringify(ticket)).toString("base64url")
    return `${body}.${signature(body, secret).toString("base64url")}`
}
export function readSopTicket(token: unknown, secret: string, workspaceId: string, userId: string, now = Date.now()): SopTicket {
    if (typeof token !== "string" || token.length > 4096) throw new Error("Invalid upload receipt.")
    const [body, mac, extra] = token.split(".")
    const expected = signature(body, secret)
    const actual = Buffer.from(mac ?? "", "base64url")
    if (extra || actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error("Invalid upload receipt.")
    const ticket = JSON.parse(Buffer.from(body, "base64url").toString()) as SopTicket
    if (ticket.workspaceId !== workspaceId || ticket.userId !== userId || !Number.isFinite(ticket.expires) || ticket.expires <= now || !/^[0-9a-f-]{36}$/i.test(ticket.id)) throw new Error("This upload receipt has expired or belongs to another account.")
    return { ...ticket, file: validateSopFile(ticket.file) }
}
