import assert from "node:assert/strict"
import test from "node:test"
import { loadBoundedCommunicationRows } from "../lib/communications/bounded-read.ts"

test("bounded decoder flag leaves unflagged reads untouched", async () => {
    const calls: string[] = []
    const response = { data: [{ id: "one" }], error: null }
    for (const kind of ["client", "native"] as const) {
        calls.length = 0
        assert.equal(await loadBoundedCommunicationRows({ enabled: false, kind, read: async (name) => { calls.push(name); return response } }), response)
        assert.deepEqual(calls, [`communication_${kind}_messages`])
        calls.length = 0
        assert.equal(await loadBoundedCommunicationRows({ enabled: true, kind, read: async (name) => { calls.push(name); return response } }), response)
        assert.deepEqual(calls, [`communication_${kind}_messages_bounded`])
    }
})

test("bounded decoder falls back only for missing additive functions, never an authorization or decrypt failure", async () => {
    for (const code of ["42883", "PGRST202", "42501", "P0001", "XX000"]) {
        const calls: string[] = []
        const error = { code, message: "Unavailable" }
        const result = await loadBoundedCommunicationRows({ enabled: true, kind: "client", read: async (name) => {
            calls.push(name)
            return name.endsWith("_bounded") ? { data: null, error } : { data: ["legacy"], error: null }
        } })
        if (["42883", "PGRST202"].includes(code)) {
            assert.deepEqual(calls, ["communication_client_messages_bounded", "communication_client_messages"])
            assert.deepEqual(result.data, ["legacy"])
        } else {
            assert.deepEqual(calls, ["communication_client_messages_bounded"])
            assert.equal(result.error, error)
        }
    }
})
