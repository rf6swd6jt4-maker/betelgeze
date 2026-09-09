import { chatCheckboxBody, chatListLine, sameChatChecklist } from "@/lib/chat-formatting"
import { ChatMutationError, chatMutationRequest } from "@/lib/communications/coordinated-updates"

export type SaveChatCheckbox = (line: number, checked: boolean, expectedBody: string) => Promise<string>
type Intent = { checked: boolean; save: SaveChatCheckbox }
type Snapshot = { body: string; pending: number[]; error: string | null }

// One queue per message: clicks remain interactive while writes are serialized.
// A second click on a busy item replaces its queued intent, never disappears.
export function createChecklistUpdates(initialBody: string) {
    let body = initialBody, generation = 0
    let error: string | null = null
    let task: Promise<void> | null = null
    const intents = new Map<number, Intent>()
    const listeners = new Set<() => void>()
    let snapshot: Snapshot = { body, pending: [], error }
    function publish() {
        let visible = body
        for (const [line, intent] of intents) visible = chatCheckboxBody(visible, line, intent.checked) ?? visible
        snapshot = { body: visible, pending: [...intents.keys()], error }
        listeners.forEach((listener) => listener())
    }
    async function drain() {
        while (intents.size) {
            const [line, intent] = intents.entries().next().value!
            const expectedBody = body, expectedGeneration = generation
            try {
                let saved: string
                try { saved = await intent.save(line, intent.checked, expectedBody) }
                catch (failure) {
                    // Setting a state is idempotent. Retry one lost/failed
                    // acknowledgement, unless the user has superseded it.
                    if (!(failure instanceof ChatMutationError) || !failure.uncertain || generation !== expectedGeneration || intents.get(line)?.checked !== intent.checked) throw failure
                    saved = await intent.save(line, intent.checked, expectedBody)
                }
                if (generation !== expectedGeneration) continue
                if (!sameChatChecklist(saved, expectedBody)) throw new ChatMutationError("This checklist was edited. Try again.")
                body = saved
                if (intents.get(line)?.checked === intent.checked) intents.delete(line)
            } catch (failure) {
                if (generation !== expectedGeneration) continue
                if (intents.get(line)?.checked === intent.checked) intents.delete(line)
                error = failure instanceof Error ? failure.message : "Could not update checkbox. Try again."
            }
            publish()
        }
    }
    function start() {
        if (task) return
        task = Promise.resolve().then(drain).finally(() => { task = null })
    }
    return {
        getSnapshot: () => snapshot,
        subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
        receive(incoming: string) {
            if (incoming === body) return
            if (intents.size && sameChatChecklist(body, incoming)) return
            if (intents.size) {
                generation++
                intents.clear()
                error = "This checklist was edited. Check the updated items and try again."
            }
            body = incoming
            publish()
        },
        toggle(line: number, save: SaveChatCheckbox) {
            const item = chatListLine(snapshot.body.split("\n")[line] ?? "")
            if (!item?.marker.startsWith("[") || !item.text.trim()) return
            intents.set(line, { checked: !/^\[[xX]\]$/.test(item.marker), save })
            error = null
            publish()
            start()
        },
        whenIdle: () => task ?? Promise.resolve(),
    }
}

export async function requestChatCheckbox(url: string, input: { messageId: string; line: number; checked: boolean; expectedBody: string; conversationId?: string; relationshipId?: string }) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 15_000)
    try {
        const result = await chatMutationRequest<{ body?: string; message?: { body?: string } }>(url, {
            method: "PATCH", headers: { "Content-Type": "application/json" },
            body: JSON.stringify(input), signal: controller.signal,
        })
        const body = result.body ?? result.message?.body
        if (typeof body !== "string") throw new ChatMutationError("Could not confirm the checkbox change. Try again.", true)
        return body
    } finally { clearTimeout(timeout) }
}
