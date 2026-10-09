import assert from "node:assert/strict"
import test from "node:test"
import { normalizeDeviceChatRead, publishDeviceChatRead, subscribeDeviceChatReads } from "../lib/communications/device-read-state.ts"
import { publishChatRead } from "../lib/communications/read-state.ts"

const read = { workspaceId: "workspace", userId: "user", kind: "native" as const, conversationId: "chat", deviceId: "device-a", lastReadAt: "2026-10-09T10:00:00.123456Z", lastReadMessageId: "message" }

test("device positions retain their explicit installation and reject mixed identities", () => {
    assert.deepEqual(normalizeDeviceChatRead("workspace", "user", "device-a", read), read)
    assert.equal(normalizeDeviceChatRead("workspace", "user", "device-b", read), null)
    assert.equal(normalizeDeviceChatRead("other-workspace", "user", "device-a", read), null)
    assert.equal(normalizeDeviceChatRead("workspace", "other-user", "device-a", read), null)
    assert.equal(normalizeDeviceChatRead("workspace", "user", "", read), null)
    assert.equal(normalizeDeviceChatRead("workspace", "user", "device-a", { ...read, lastReadAt: "invalid" }), null)
})

test("legacy account acknowledgements cannot enter the installation read channel", () => {
    const original = { window: globalThis.window, BroadcastChannel: globalThis.BroadcastChannel }
    Object.assign(globalThis, { window: { top: new EventTarget() }, BroadcastChannel: undefined })
    const received: unknown[] = []
    const unsubscribe = subscribeDeviceChatReads("workspace", "user", value => received.push(value))
    try {
        publishChatRead(read)
        assert.deepEqual(received, [], "an account receipt is not a device acknowledgement")
        publishDeviceChatRead({ ...read, userId: "other-user" })
        publishDeviceChatRead({ ...read, workspaceId: "other-workspace" })
        assert.deepEqual(received, [])
        publishDeviceChatRead(read)
        assert.deepEqual(received, [read])
        unsubscribe()
        publishDeviceChatRead(read)
        assert.equal(received.length, 1)
    } finally { unsubscribe(); Object.assign(globalThis, original) }
})
