import assert from "node:assert/strict"
import test from "node:test"
import { readFileSync } from "node:fs"
import { createRequire, Module } from "node:module"
import { resolve } from "node:path"
import ts from "typescript"
import { recordVersionAfter, reconcileRecordTextDraft } from "../lib/record-version.js"

const version = (fraction: string) => `2026-09-10T12:00:00.${fraction}Z`
const draft = (value = "Original") => ({ value, baseline: "Original", version: version("000001"), conflict: null })

test("a pristine description receives another tab's refreshed text before its next edit", () => {
    const refreshed = reconcileRecordTextDraft(draft(), { value: "Edited in another tab", version: version("000002") })
    assert.deepEqual(refreshed, { value: "Edited in another tab", baseline: "Edited in another tab", version: version("000002"), conflict: null })
})

test("a dirty description never borrows the version of conflicting remote text", () => {
    const local = draft("My unsaved description")
    const remote = { value: "Another person's description", version: version("000002") }
    const result = reconcileRecordTextDraft(local, remote)
    assert.equal(result.value, local.value, "the local draft stays available for recovery")
    assert.equal(result.baseline, "Original")
    assert.equal(result.version, version("000001"), "a save must still fail compare-and-swap against the old baseline")
    assert.deepEqual(result.conflict, remote)
})

test("another field changing can advance the version without discarding a description draft", () => {
    const result = reconcileRecordTextDraft(draft("My draft"), { value: "Original", version: version("000002") })
    assert.equal(result.value, "My draft")
    assert.equal(result.baseline, "Original")
    assert.equal(result.version, version("000002"))
    assert.equal(result.conflict, null)
})

test("late snapshots before a save acknowledgement cannot restore older text", () => {
    const acknowledged = { value: "Saved", baseline: "Saved", version: version("000003"), conflict: null }
    assert.equal(reconcileRecordTextDraft(acknowledged, { value: "Original", version: version("000001") }), acknowledged)
    assert.equal(reconcileRecordTextDraft(acknowledged, { value: "Saved", version: "2026-09-10T12:00:00.000003+00:00" }), acknowledged)
    const newer = reconcileRecordTextDraft({ ...acknowledged, value: "My next draft" }, { value: "Concurrent newer change", version: version("000004") })
    assert.equal(newer.value, "My next draft")
    assert.equal(newer.version, acknowledged.version)
    assert.equal(newer.conflict?.value, "Concurrent newer change")
})

test("an older conflict response cannot replace the latest value offered for recovery", () => {
    const conflicted = reconcileRecordTextDraft(draft("My draft"), { value: "Newest remote text", version: version("000004") })
    assert.equal(reconcileRecordTextDraft(conflicted, { value: "Older remote text", version: version("000003") }), conflicted)
})

test("matching remote text resolves a draft without submitting it twice", () => {
    const result = reconcileRecordTextDraft(draft("Same intended text"), { value: "Same intended text", version: version("000002") })
    assert.deepEqual(result, { value: "Same intended text", baseline: "Same intended text", version: version("000002"), conflict: null })
})

// Drive the real editor's hooks, effects and handlers without a browser or any
// database writes. Child presentation primitives remain inert element wrappers.
function editorFixture() {
    type ElementNode = { type?: unknown; props?: Record<string, unknown> }
    type Slot = { value?: unknown; deps?: unknown[]; cleanup?: (() => void) | undefined }
    const slots: Slot[] = []
    let cursor = 0, changed = false
    let effects: Array<() => void> = []
    let flush!: () => Promise<boolean>
    let respond: ((result: { ok: true; version: string }) => void) | undefined
    const saves: Array<{ value: string; version: string }> = []
    const router = { refresh: () => {} }
    const same = (left?: unknown[], right?: unknown[]) => Boolean(left && right && left.length === right.length && left.every((value, index) => Object.is(value, right[index])))
    function useState(initial: unknown) {
        const index = cursor++
        if (!slots[index]) slots[index] = { value: typeof initial === "function" ? initial() : initial }
        return [slots[index].value, (value: unknown) => {
            const next = typeof value === "function" ? value(slots[index].value) : value
            if (!Object.is(next, slots[index].value)) { slots[index].value = next; changed = true }
        }]
    }
    function memoHook(create: () => unknown, deps: unknown[]) {
        const index = cursor++
        if (!slots[index] || !same(slots[index].deps, deps)) slots[index] = { value: create(), deps }
        return slots[index].value
    }
    const dependencies: Record<string, unknown> = {
        react: {
            createContext: (value: unknown) => ({ Provider: "context", value }), useContext: (context: { value: unknown }) => context.value,
            useState, useRef: (value: unknown) => useState(() => ({ current: value }))[0], useMemo: memoHook,
            useCallback: (callback: unknown, deps: unknown[]) => memoHook(() => callback, deps),
            useTransition: () => [false, (run: () => unknown) => run()],
            useEffect: (create: () => (() => void) | undefined, deps?: unknown[]) => {
                const index = cursor++
                const previous = slots[index]
                if (!previous || !same(previous.deps, deps)) {
                    const slot: Slot = { deps }
                    slots[index] = slot
                    effects.push(() => { previous?.cleanup?.(); slot.cleanup = create() })
                }
            },
        },
        "@/components/workspace/WorkspaceNavigation": { useRouter: () => router },
        "@/components/ui": { AnchoredPopup: "popup", Assignee: "assignee", RoundPill: "pill", Status: "status" },
        "@/components/account/Avatar": { Avatar: "avatar" },
        "@/lib/workspace-member-profile": { openWorkspaceMemberProfile: () => {} },
        "@/components/detail": { DetailField: "field", DetailFields: "fields" },
        "@/lib/ui/gantt-sync": { postGanttSync: () => {} },
        "@/lib/work-item-priority": { workItemPrioritySelectionLabel: () => "System generated", workItemPrioritySelectionOptions: [] },
        "@/lib/workspace-mutations": { registerWorkspaceAutosaveFlusher: (callback: typeof flush) => { flush = callback; return () => {} }, runWorkspaceMutation: (run: () => unknown) => run() },
        "@/lib/record-version": { recordVersionAfter, reconcileRecordTextDraft },
        "./actions": { updateWorkItemDescription: (_slug: string, _id: string, value: string, expectedVersion: string) => {
            saves.push({ value, version: expectedVersion })
            return new Promise<{ ok: true; version: string }>((resolve) => { respond = resolve })
        } },
    }
    const file = "app/[workspaceSlug]/work-items/[id]/InlineWorkItemFields.tsx"
    const compiled = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX } }).outputText
    const localRequire = createRequire(resolve(file))
    const compiledModule = new Module(resolve(file)) as Module & { _compile: (source: string, filename: string) => void }
    compiledModule.require = ((name: string) => name in dependencies ? dependencies[name] : localRequire(name)) as typeof compiledModule.require
    compiledModule._compile(compiled, file)
    const properties = { workspaceSlug: "example", workItemId: "record", updatedAt: version("000001"), description: "Original", status: "todo", assignees: [], manualDependencyIds: [], dependencies: [], relationships: [], keyResults: [], workOptions: [], relationshipOptions: [], keyResultOptions: [], members: [] }
    let tree: ElementNode
    const oldWindow = Object.getOwnPropertyDescriptor(globalThis, "window")
    const oldDocument = Object.getOwnPropertyDescriptor(globalThis, "document")
    const host = { addEventListener() {}, removeEventListener() {}, setTimeout: () => 1, clearTimeout() {}, parent: {} }
    host.parent = host
    Object.defineProperty(globalThis, "window", { configurable: true, value: host })
    Object.defineProperty(globalThis, "document", { configurable: true, value: { addEventListener() {}, removeEventListener() {} } })
    function render(updates = {}) {
        Object.assign(properties, updates)
        let passes = 0
        do {
            if (++passes > 12) throw new Error("Editor render did not settle")
            cursor = 0; changed = false; effects = []
            tree = compiledModule.exports.InlineWorkItemFields(properties)
            effects.forEach((effect) => effect())
        } while (changed)
    }
    function find(predicate: (node: ElementNode) => boolean, current: unknown = tree): ElementNode | undefined {
        if (Array.isArray(current)) return current.map((node) => find(predicate, node)).find(Boolean)
        if (!current || typeof current !== "object") return undefined
        const node = current as ElementNode
        return predicate(node) ? node : node.props?.children === undefined ? undefined : find(predicate, node.props.children)
    }
    const textarea = () => find((node) => node.type === "textarea" && node.props?.placeholder === "Add a description…")!
    return {
        render, saves, flush: () => flush(), value: () => textarea().props!.value,
        edit: (value: string) => { (textarea().props!.onChange as (event: unknown) => void)({ target: { value } }); render() },
        acknowledge: (nextVersion: string) => respond!({ ok: true, version: nextVersion }),
        useLatest: () => { const button = find((node) => node.type === "button" && node.props?.children === "Use latest version"); assert.ok(button); (button.props!.onClick as () => void)(); render() },
        dispose: () => { slots.forEach((slot) => slot.cleanup?.()); if (oldWindow) Object.defineProperty(globalThis, "window", oldWindow); else Reflect.deleteProperty(globalThis, "window"); if (oldDocument) Object.defineProperty(globalThis, "document", oldDocument); else Reflect.deleteProperty(globalThis, "document") },
    }
}

test("the actual editor refreshes pristine text and blocks a dirty conflicting save until explicit recovery", async () => {
    const editor = editorFixture()
    try {
        editor.render()
        editor.render({ description: "Remote update", updatedAt: version("000002") })
        assert.equal(editor.value(), "Remote update")
        editor.edit("My draft")
        editor.render({ description: "New remote update", updatedAt: version("000003") })
        assert.equal(editor.value(), "My draft")
        assert.equal(await editor.flush(), false)
        assert.equal(editor.saves.length, 0)
        editor.useLatest()
        assert.equal(editor.value(), "New remote update")
        assert.equal(await editor.flush(), true)
    } finally { editor.dispose() }
})

test("the actual editor accepts an in-flight write snapshot only after its acknowledgement", async () => {
    const editor = editorFixture()
    try {
        editor.render()
        editor.edit("  Saved text  ")
        const saving = editor.flush()
        editor.render({ description: "Saved text", updatedAt: version("000002") })
        assert.equal(editor.value(), "  Saved text  ")
        editor.acknowledge(version("000002"))
        assert.equal(await saving, true)
        editor.render()
        assert.equal(editor.value(), "Saved text")
        editor.edit("Next edit")
        const nextSave = editor.flush()
        assert.equal(editor.saves[1].version, version("000002"))
        editor.acknowledge(version("000003"))
        assert.equal(await nextSave, true)
    } finally { editor.dispose() }
})

test("a newer remote edit arriving during a save prevents the next queued local overwrite", async () => {
    const editor = editorFixture()
    try {
        editor.render()
        editor.edit("First save")
        const saving = editor.flush()
        editor.edit("My next unsaved change")
        editor.render({ description: "Another writer after my first save", updatedAt: version("000003") })
        editor.acknowledge(version("000002"))
        assert.equal(await saving, false)
        editor.render()
        assert.equal(editor.value(), "My next unsaved change")
        assert.equal(editor.saves.length, 1)
        assert.equal(await editor.flush(), false)
    } finally { editor.dispose() }
})
