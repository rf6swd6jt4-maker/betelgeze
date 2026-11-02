import { Avatar } from "@/components/account/Avatar"
import { deliveryReceiptStages } from "@/lib/communications/delivery-receipts"
import { readCursorCoversMessage } from "@/lib/communications/read-state"
import type { CommunicationDelivery, CommunicationMessage, CommunicationPerson, CommunicationReadCursor } from "@/lib/communications/types"
import type { NativeMessage, NativeReadCursor } from "@/lib/teams/types"

export type MessageInfoProps = {
    message: CommunicationMessage | NativeMessage
    sender: string
    preview: string
    memberIds?: string[]
    people: ReadonlyMap<string, CommunicationPerson>
    cursors: (CommunicationReadCursor | NativeReadCursor)[]
    currentUserId: string
}

const formatTime = new Intl.DateTimeFormat("en-IE", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZoneName: "short" })

function Timestamp({ value }: { value: string }) {
    return <time dateTime={value}>{formatTime.format(new Date(value))}</time>
}

function DeliveryReceipt({ delivery, createdAt }: { delivery: CommunicationDelivery | CommunicationMessage; createdAt: string }) {
    const channels: Record<string, string> = { meta_whatsapp: "WhatsApp", twilio_sms: "SMS", client_portal: "Client portal" }
    const channel = channels[delivery.provider] ?? "Client"
    const stages = deliveryReceiptStages(delivery, createdAt)
    return <section className="space-y-1.5">
        <h3 className="text-sm font-semibold">{channel} delivery</h3>
        {stages.length ? <dl>{stages.map(stage => <div key={stage.label} className="flex flex-wrap justify-between gap-x-3 py-1 text-sm">
            <dt className="text-neutral-400">{stage.label}</dt><dd>{stage.time ? <Timestamp value={stage.time} /> : "Time unavailable"}</dd>
        </div>)}</dl> : <p className="text-sm text-neutral-400">{delivery.status === "send_uncertain" ? "Awaiting send confirmation" : "No delivery receipt yet"}</p>}
    </section>
}

export default function MessageInfoContent({ message, sender, preview, memberIds, people, cursors, currentUserId }: MessageInfoProps) {
    const client = "relationshipId" in message
    const seenIds = new Set(cursors.filter(cursor => (
        client ? "relationshipId" in cursor && cursor.relationshipId === message.relationshipId
            : "conversationId" in cursor && cursor.conversationId === message.conversationId
    ) && cursor.userId !== message.senderUserId && readCursorCoversMessage(cursor, message)).map(cursor => cursor.userId))
    const recipients = (memberIds ?? [...seenIds]).filter(id => id !== message.senderUserId)
    const seenCount = recipients.filter(id => seenIds.has(id)).length
    let summary = "Participant list unavailable"
    if (memberIds) {
        summary = recipients.length ? `Seen by ${seenCount} of ${recipients.length}` : "No other participants"
        if (recipients.length && seenCount === recipients.length) {
            summary = client ? "Seen by all current staff participants" : "Seen by everyone"
        }
    }
    const deliveries = client && message.direction === "outbound" ? message.deliveries?.length ? message.deliveries : [message] : []
    return <div className="space-y-5">
        <div className="border-l-2 border-neutral-600 pl-3">
            <p className="text-sm font-semibold">{sender}</p>
            <p className="mt-1 line-clamp-2 whitespace-pre-line break-words text-sm text-neutral-300">{preview}</p>
            <p className="mt-1.5 text-xs text-neutral-400">{client ? message.direction === "inbound" ? "Received" : "Created" : "Sent"} · <Timestamp value={message.createdAt} /></p>
        </div>
        {deliveries.map(delivery => <DeliveryReceipt key={delivery.provider} delivery={delivery} createdAt={message.createdAt} />)}
        <section>
            <h3 className="text-sm font-semibold">{client ? "Staff read receipts" : "Read receipts"}</h3>
            <p className="mt-1 text-sm text-neutral-400">{summary}</p>
            <ul className="mt-2 divide-y divide-neutral-800">{recipients.map(id => {
                const person = people.get(id)
                const name = id === currentUserId ? "You" : person?.name ?? "Team member"
                return <li key={id} className="flex min-h-10 items-center gap-2 py-1.5 text-sm">
                    <span className="flex h-7 w-7 shrink-0 overflow-hidden rounded-full"><Avatar src={person?.avatarSrc ?? null} name={name} className="h-full w-full" /></span>
                    <span className="min-w-0 flex-1 break-words">{name}</span>
                    <span className="shrink-0 text-xs text-neutral-400">{seenIds.has(id) ? "Seen" : "No receipt yet"}</span>
                </li>
            })}</ul>
        </section>
    </div>
}
