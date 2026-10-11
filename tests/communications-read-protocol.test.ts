import assert from "node:assert/strict"
import test from "node:test"
import { negotiatedCommunicationReadProtocol } from "../lib/communications/read-protocol.ts"
import { normalizeWorkspaceUrl, workspaceTabFrameMatchesUrl, workspaceTabFrameUrl } from "../lib/workspace-tabs.ts"

const scope = { workspaceId: "w", userId: "u" }
test("a new child follows its mounted shell protocol and cannot promote an old shell", () => {
    assert.equal(negotiatedCommunicationReadProtocol(scope, "device-v1", undefined, true), "account-v1")
    assert.equal(negotiatedCommunicationReadProtocol(scope, "device-v1", { ...scope, readProtocol: "account-v1" }, true), "account-v1")
    assert.equal(negotiatedCommunicationReadProtocol(scope, "account-v1", { ...scope, readProtocol: "device-v1" }, true), "device-v1")
    assert.equal(negotiatedCommunicationReadProtocol(scope, "device-v1", { ...scope, userId: "other", readProtocol: "device-v1" }, true), "account-v1")
    assert.equal(negotiatedCommunicationReadProtocol(scope, "device-v1", { ...scope, workspaceId: "other", readProtocol: "device-v1" }, true), "account-v1")
})
test("a standalone route retains its server-selected protocol", () => {
    assert.equal(negotiatedCommunicationReadProtocol(scope, "device-v1", undefined, false), "device-v1")
    assert.equal(negotiatedCommunicationReadProtocol(scope, "account-v1", undefined, false), "account-v1")
})
test("frame bootstrap carries protocol without leaking it into navigation identity", () => {
    const url = "/acme/communications?mode=team&nativeConversation=chat#anchor"
    const framed = workspaceTabFrameUrl(url, "tab", "https://be.test", "device-v1")
    assert.equal(new URL(framed, "https://be.test").searchParams.get("readProtocol"), "device-v1")
    assert.equal(normalizeWorkspaceUrl(framed, "acme", "https://be.test"), url)
    assert.equal(workspaceTabFrameMatchesUrl(framed, url, "tab", "https://be.test"), true)
    assert.equal(workspaceTabFrameMatchesUrl(framed, url, "other", "https://be.test"), false)
    assert.equal(workspaceTabFrameUrl("/acme/work", "tab", "https://be.test", "device-v1").includes("readProtocol"), false)
})

test("protocol scope metadata is available before hydration and inaccessible parents fail to account compatibility", async () => {
    const { readCommunicationReadProtocol, hostedCommunicationReadProtocol } = await import("../lib/communications/read-protocol.ts")
    const previous = { window: globalThis.window, document: globalThis.document }
    const attributes = new Map([["data-communications-read-protocol", "device-v1"], ["data-communications-workspace", "w"], ["data-communications-user", "u"], ["data-communications-workspace-slug", "acme"]])
    const top = { document: { querySelector: () => ({ getAttribute: (key: string) => attributes.get(key) ?? null }) } }
    Object.assign(globalThis, { window: { top }, document: { body: { dataset: {} }, querySelector: () => null } })
    try {
        assert.equal(readCommunicationReadProtocol("w", "u", "account-v1"), "device-v1")
        assert.equal(readCommunicationReadProtocol("w", "other", "device-v1"), "account-v1")
        assert.equal(hostedCommunicationReadProtocol("acme"), "device-v1")
        assert.equal(hostedCommunicationReadProtocol("other"), "account-v1")
        Object.defineProperty(top, "document", { get: () => { throw new Error("cross-origin") } })
        assert.equal(readCommunicationReadProtocol("w", "u", "device-v1"), "account-v1")
    } finally { Object.assign(globalThis, previous) }
})
