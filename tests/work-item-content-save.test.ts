import assert from "node:assert/strict"
import test from "node:test"
import { readFileSync } from "node:fs"
import ts from "typescript"

function fixture() {
    const row: Record<string, unknown> = { id: "work", workspace_id: "workspace", updated_at: "v1", description: "Goal", instructions: "Procedure", evidence: "Source", area: "workspace", visibility: "workspace" }
    let allowed = true, role = "admin", writes = 0
    const readColumns: string[] = []
    const db = { rpc: async (name: string, input: Record<string,string>) => {
        assert.equal(name,"save_work_item_text")
        if (row.workspace_id!==input.p_workspace || row.id!==input.p_item || (row[input.p_field]??"")!==input.p_baseline) return {data:null}
        row[input.p_field]=input.p_value.trim()||null;row.updated_at="v"+(++writes+1)
        return {data:row.updated_at}
    }, from: () => {
        let patch: Record<string, unknown> | null = null
        const filters: Array<[string, unknown]> = []
        const q = { select: (columns: string) => { readColumns.push(columns); return q }, returns: () => q, eq: (key: string, value: unknown) => { filters.push([key,value]); return q }, is: (key: string, value: unknown) => { filters.push([key,value]); return q }, update: (value: Record<string,unknown>) => { patch=value;return q }, maybeSingle: async () => {
            if (!filters.every(([key,value])=>row[key]===value)) return { data:null }
            if (patch) { Object.assign(row,patch);writes++ }
            return { data:{...row} }
        } }; return q
    } }
    const mocks: Record<string,unknown> = {
        "next/cache": { revalidatePath() {} }, "@/lib/supabase/admin": { supabaseAdmin: db }, "@/lib/relationships": { workItemHref: () => "/work" },
        "@/lib/workspace-access": { requireWorkspaceAccess: async () => ({workspace:{id:"workspace"},role,access:{}}), workspaceAccessCanWorkItem: async () => allowed, workspaceAccessHasCapability: () => true },
    }
    const compiledModule = { exports: {} }
    const file="app/[workspaceSlug]/work-items/[id]/actions.ts"
    const code=ts.transpileModule(readFileSync(file,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
    new Function("require","module","exports",code)((name:string)=>mocks[name],compiledModule,compiledModule.exports)
    return { actions: compiledModule.exports as typeof import("../app/[workspaceSlug]/work-items/[id]/actions"), row, readColumns, writes:()=>writes, staffDenied:()=>{role="staff";allowed=false} }
}
test("description and instructions can save concurrently without overwriting each other or source evidence", async () => {
    const f=fixture()
    const result=await Promise.all([f.actions.updateWorkItemDescription("acme","work"," New goal ","v1","Goal"),f.actions.updateWorkItemInstructions("acme","work"," New procedure ","Procedure")])
    assert(result.every(r=>r.ok));assert.equal(f.writes(),2)
    assert.equal(f.row.description,"New goal");assert.equal(f.row.instructions,"New procedure");assert.equal(f.row.evidence,"Source")
    assert(f.readColumns.every(c=>!c.includes("evidence")))
    assert(f.readColumns.every(c=>!(c.includes("description")&&c.includes("instructions"))))
})
test("same-field racing saves accept only one writer and missing baseline cannot cause blind overwrite", async () => {
    const f=fixture()
    const result=await Promise.all([f.actions.updateWorkItemInstructions("acme","work","One","Procedure"),f.actions.updateWorkItemInstructions("acme","work","Two","Procedure")])
    assert.equal(result.filter(r=>r.ok).length,1);assert.equal(f.writes(),1)
    assert.equal((await f.actions.updateWorkItemInstructions("acme","work","Blind",undefined as unknown as string)).ok,false)
    assert.equal(f.row.instructions,"One")
})
test("content mutations preserve work-item authorization and reject oversized input", async () => {
    const f=fixture()
    assert.equal((await f.actions.updateWorkItemInstructions("acme","work","a".repeat(100001),"Procedure")).ok,false)
    f.staffDenied()
    await assert.rejects(f.actions.updateWorkItemInstructions("acme","work","Unauthorized","Procedure"),/not found/)
    assert.equal(f.writes(),0)
})
