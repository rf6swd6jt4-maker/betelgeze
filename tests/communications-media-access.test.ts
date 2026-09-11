import assert from "node:assert/strict"
import test from "node:test"
import { readFile } from "node:fs/promises"
import ts from "typescript"

function deferred<T>() {
    let resolve!: (value: T) => void
    const promise = new Promise<T>((done) => { resolve = done })
    return { promise, resolve }
}

test("media overlaps permission checks but never fetches storage before all allow access", async () => {
    const source = await readFile("app/api/client-messages/media/[...path]/route.ts", "utf8")
    const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
    for (const denied of ["membership", "conversation", null]) {
        const membership = deferred<{ data: unknown }>()
        const conversation = deferred<string | null>()
        const key = deferred<string | null>()
        const started: string[] = []
        let storage = 0
        const query = { select() { return this }, eq() { return this }, maybeSingle() { started.push("membership"); return membership.promise } }
        const mocks: Record<string, unknown> = {
            "@/lib/workspaces": { getCurrentUser: async () => ({ id: "user" }) },
            "@/lib/supabase/admin": { supabaseAdmin: { from: () => query } },
            "@/lib/teams/server": { assertNativeConversationAccess: () => { started.push("conversation"); return conversation.promise } },
            "@/lib/communications/encryption": { communicationFileKeyForCurrentUser: () => { started.push("key"); return key.promise } },
            "@/lib/communications/attachments": { COMMUNICATION_PREVIEW_SUFFIX: ".preview.webp" },
            "@/lib/communications/media-http": {
                loadCommunicationMediaRepresentation: async () => { storage++; return { response: new Response("image"), deliveryPath: "image" } },
                communicationMediaStatusIsValid: () => true,
            },
        }
        const exports: { GET?: (request: Request, context: unknown) => Promise<Response> } = {}
        new Function("require", "exports", compiled)((name: string) => mocks[name] ?? {}, exports)
        const response = exports.GET!(new Request("https://example.test/media?preview=1"), { params: Promise.resolve({ path: ["workspace", "communications", "native", "conversation", "image"] }) })
        await new Promise((resolve) => setImmediate(resolve))
        assert.deepEqual(started.sort(), ["conversation", "key", "membership"])
        assert.equal(storage, 0)
        membership.resolve({ data: denied === "membership" ? null : { user_id: "user" } })
        conversation.resolve(denied === "conversation" ? null : "conversation")
        await new Promise((resolve) => setImmediate(resolve))
        assert.equal(storage, 0)
        // A key failure rejects rather than reaching the legacy unencrypted fallback.
        // A missing key is checked separately by existing sticker/client authorization.
        key.resolve("private-key")
        const result = await response
        assert.equal(result.status, denied === "membership" || denied === "conversation" ? 404 : 200)
        assert.equal(storage, denied === "membership" || denied === "conversation" ? 0 : 1)
    }
})
