import { execFileSync } from "node:child_process"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import ts from "typescript"

const root = process.cwd()
const sourceFiles = execFileSync("rg", ["--files", "app", "components", "lib", "-g", "*.ts", "-g", "*.tsx"], { cwd: root, encoding: "utf8" }).trim().split("\n").sort()
const modules = new Map()
const httpMethods = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"])
const hasModifier = (node, kind) => node.modifiers?.some((modifier) => modifier.kind === kind) === true
const literalDirective = (statements, value) => statements.some((statement) => ts.isExpressionStatement(statement) && ts.isStringLiteral(statement.expression) && statement.expression.text === value)

function resolveImport(file, specifier) {
    const base = specifier.startsWith("@/") ? path.join(root, specifier.slice(2)) : specifier.startsWith(".") ? path.resolve(root, path.dirname(file), specifier) : null
    if (!base) return null
    for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx")]) {
        const relative = path.relative(root, candidate)
        if (sourceFiles.includes(relative)) return relative
    }
    return null
}

for (const file of sourceFiles) {
    const text = readFileSync(path.join(root, file), "utf8")
    const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)
    const mode = literalDirective(ast.statements, "use client") ? "client" : literalDirective(ast.statements, "use server") ? "server-actions" : "server/default"
    const imports = []
    const exportedFunctions = []
    const inlineActions = []
    const calls = new Set()
    const tables = new Set()
    for (const statement of ast.statements) {
        if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier) && !statement.importClause?.isTypeOnly) {
            const specifier = statement.moduleSpecifier.text
            imports.push({ specifier, file: resolveImport(file, specifier) })
        }
        if (ts.isExportDeclaration(statement) && statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier) && !statement.isTypeOnly) {
            const specifier = statement.moduleSpecifier.text
            imports.push({ specifier, file: resolveImport(file, specifier) })
        }
        if (ts.isFunctionDeclaration(statement) && statement.name && hasModifier(statement, ts.SyntaxKind.ExportKeyword)) exportedFunctions.push(statement.name.text)
        if (ts.isVariableStatement(statement) && hasModifier(statement, ts.SyntaxKind.ExportKeyword)) {
            for (const declaration of statement.declarationList.declarations) {
                if (declaration.initializer && (ts.isArrowFunction(declaration.initializer) || ts.isFunctionExpression(declaration.initializer))) exportedFunctions.push(declaration.name.getText(ast))
            }
        }
    }
    function visit(node) {
        if (ts.isCallExpression(node)) {
            if (ts.isIdentifier(node.expression) && /^(?:require|load|get|list|count|save|update|create|delete|archive|submit|send|deliver|process|sync|record|complete|restart|revoke|ensure|verify|resolve|accessible)/.test(node.expression.text)) calls.add(node.expression.text)
            if (ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "from" && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) tables.add(node.arguments[0].text)
        }
        if ((ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node)) && node.body && ts.isBlock(node.body) && literalDirective(node.body.statements, "use server")) {
            const name = node.name?.getText(ast) ?? (ts.isVariableDeclaration(node.parent) ? node.parent.name.getText(ast) : "inline")
            inlineActions.push({ name, line: ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1 })
        }
        ts.forEachChild(node, visit)
    }
    visit(ast)
    modules.set(file, { file, mode, imports, exportedFunctions, inlineActions, calls: [...calls].sort(), tables: [...tables].sort() })
}

function serverDependencies(file, seen = new Set()) {
    if (seen.has(file)) return []
    seen.add(file)
    const sourceModule = modules.get(file)
    if (!sourceModule || sourceModule.mode === "client" || sourceModule.mode === "server-actions") return []
    const found = []
    for (const entry of sourceModule.imports) {
        if (["server-only", "next/headers", "next/cache", "@/lib/supabase/admin", "@/lib/supabase/server"].includes(entry.specifier) || entry.specifier.startsWith("node:")) found.push(`${file} → ${entry.specifier}`)
        else if (entry.file) found.push(...serverDependencies(entry.file, seen))
    }
    return [...new Set(found)]
}

function surface(file) {
    if (file.startsWith("app/~performance-fixture/")) return "local validation fixture"
    if (file.includes("client-portal") || file.includes("onboarding/session") || file.includes("onboarding/preview")) return "token/public boundary"
    if (file.startsWith("app/[workspaceSlug]/onboarding-builder")) return "standalone builder"
    if (file.startsWith("app/[workspaceSlug]/") || file.startsWith("app/~workspace-shell/") || file.startsWith("app/api/workspaces/")) return "staff workspace"
    if (file.startsWith("app/api/")) return "shared API/provider"
    return "account/public"
}

// This explicit registry records implementation evidence separately from static
// extraction blockers. It must never imply authenticated or latency certification.
const nativePageModules = new Map([
    ["relationships/page.tsx", "relationships"], ["relationships/[relationshipId]/page.tsx", "relationships"],
    ["assets/page.tsx", "library"], ["assets/[id]/page.tsx", "library"],
    ["work-items/page.tsx", "library"], ["work-items/[id]/page.tsx", "library"],
    ["work/page.tsx", "work"], ["work/[relationshipId]/page.tsx", "work"],
    ["admin/page.tsx", "admin"], ["admin/okrs/page.tsx", "admin"], ["admin/okrs/[okrId]/page.tsx", "admin"],
    ["admin/maintenance/page.tsx", "admin"], ["admin/activity/page.tsx", "admin"], ["admin/activity/[eventId]/page.tsx", "admin"],
    ["appointment-setting/page.tsx", "appointment"], ["appointment-setting/[relationshipId]/page.tsx", "appointment"],
])

function pageImplementation(file) {
    const nativeModule = nativePageModules.get(file.replace(/^app\/\[workspaceSlug\]\//, ""))
    if (nativeModule) return {
        status: "implemented; gated",
        gate: "WORKSPACE_NATIVE_PANELS (unset by default; exact workspace UUID allowlist or explicit all)",
        evidence: [`lib/workspace-native-${nativeModule}.ts`, "lib/workspace-native.ts", "components/workspace/NativeWorkspaceTab.tsx"],
        remaining: "authenticated old/new parity, pending-edit and permission scenarios, controlled latency and physical-device checks",
    }
    if (file === "app/[workspaceSlug]/communications/page.tsx") return {
        status: "shared path optimizations implemented; native migration remaining", gate: "history RPC migration required for optimized page path; existing fallback retained",
        evidence: ["lib/communications/history-page.ts", "lib/communications/mode-resource.ts", "lib/communications/message-batches.ts", "components/communications/CommunicationsPanel.tsx"],
        remaining: "authenticated history/mode parity, recovery and physical-device checks; no native shell view extracted",
    }
    if (file.startsWith("app/~workspace-shell/")) return {
        status: "mixed native/frame shell implemented; gated", gate: "WORKSPACE_NATIVE_PANELS",
        evidence: ["components/workspace/WorkspaceTopBar.tsx", "components/workspace/WorkspaceTopBarClient.tsx"],
        remaining: "authenticated lifecycle, tab churn and memory measurements; remaining modules retain frames",
    }
    if (file.startsWith("app/~performance-fixture/")) return {
        status: "local validation fixture", gate: "development fixture; not a production performance result",
        evidence: [file], remaining: "exclude from production rollout; synthetic data cannot certify real access or backend timings",
    }
    if (file.startsWith("app/[workspaceSlug]/") && surface(file) === "staff workspace") return {
        status: "native migration remaining", gate: null, evidence: [file],
        remaining: "existing frame/server path retained; inventory extraction review does not implement its migration",
    }
    return {
        status: "existing standalone boundary retained", gate: null, evidence: [file],
        remaining: "shared-path changes may apply; no route-specific performance completion claim",
    }
}

function handlerImplementation(file) {
    if (file.includes("/panels/")) return "authorized JSON loader implemented; selected by gated native client"
    if (/\/appointment-setting\/\[relationshipId\]\/(draft|submit)\//.test(file) || file.includes("/relationships/[relationshipId]/background/")) return "versioned command implemented; gated client, receipt migration and staged checks required"
    if (file.includes("/cron/appointment-notifications/")) return "durable worker implemented; migration, scheduler and outbox readiness flag required"
    if (file.includes("/performance/")) return "content-free telemetry implemented; interaction table migration required for persistence"
    if (file.includes("/communications/") && file.endsWith("/messages/route.ts")) return "history path optimized; migration and authenticated behavior checks required"
    return "existing endpoint retained; completion semantics require per-flow review"
}

const pages = sourceFiles.filter((file) => /\/page\.tsx?$/.test(file)).map((file) => {
    const sourceModule = modules.get(file)
    const blockers = serverDependencies(file)
    return {
        file, route: `/${file.replace(/^app\//, "").replace(/\/page\.tsx?$/, "")}`.replace(/\/page\.tsx?$/, "/"),
        surface: surface(file), mode: sourceModule.mode,
        implementation: pageImplementation(file),
        extraction: sourceModule.mode === "client" ? "client view exists; audit navigation/session assumptions" : blockers.length ? "extract server loader + serializable view model before native import" : "review presentation extraction",
        directCalls: sourceModule.calls, directTables: sourceModule.tables, serverDependencies: blockers,
        clientChildren: sourceModule.imports.flatMap((entry) => entry.file && modules.get(entry.file)?.mode === "client" ? [entry.file] : []),
        verification: "not performance-certified; fixture, permission and completion review required",
    }
})
const handlers = sourceFiles.filter((file) => /\/route\.tsx?$/.test(file)).map((file) => {
    const sourceModule = modules.get(file)
    return { file, surface: surface(file), implementation: handlerImplementation(file), methods: sourceModule.exportedFunctions.filter((name) => httpMethods.has(name)), directCalls: sourceModule.calls, directTables: sourceModule.tables }
})
const actions = [...modules.values()].flatMap((sourceModule) => {
    const exported = sourceModule.mode === "server-actions" ? sourceModule.exportedFunctions.map((name) => ({ file: sourceModule.file, name, kind: "exported action", surface: surface(sourceModule.file), directCalls: sourceModule.calls, directTables: sourceModule.tables })) : []
    return [...exported, ...sourceModule.inlineActions.map((action) => ({ file: sourceModule.file, ...action, kind: "inline action", surface: surface(sourceModule.file), directCalls: sourceModule.calls, directTables: sourceModule.tables }))]
})
const report = { schemaVersion: 2, scope: "all app pages, route handlers, exported use-server actions and inline use-server functions; static evidence, not runtime proof", pages, handlers, actions }
const escape = (value) => String(value).replaceAll("|", "\\|").replaceAll("\n", " ")
const join = (values) => values.length ? values.map((value) => `\`${escape(value)}\``).join(", ") : "—"
const lines = [
    "# Workspace performance route and action inventory", "",
    "Generated with `node scripts/inventory-workspace-performance.mjs`. Regenerate after adding routes/actions. This is a complete static inventory of discovered source boundaries, **not a claim that routes are migrated, permission-audited or fast**.", "",
    `Found **${pages.length} pages**, **${handlers.length} HTTP route handlers** and **${actions.length} server actions**. The companion JSON includes each direct database table, loader/command call, client child and transitive server dependency. Type-only imports and imported Server Action proxies are excluded from client extraction blockers. Runtime dynamic imports, helper internals and background subscription lifecycles still require flow-level review.`, "",
    `**${pages.filter((page) => page.implementation.status === "implemented; gated").length} existing product page patterns** have native client views and authorized JSON loaders. They remain gated by \`WORKSPACE_NATIVE_PANELS\`; unset preserves the previous frame path. Onboarding management, Settings and LeadGen native views remain unimplemented. Communications receives shared read/history/lifecycle improvements but still uses its existing frame route. Standalone builder and public/token routes retain their separate boundaries. Any local validation fixture is explicitly listed and is not product-route or authenticated evidence.`, "",
    "The presentation-boundary column describes the original page source, which deliberately remains available for rollback. An extracted native view does not remove its original server-only imports. Native implementation evidence, enablement gates and remaining checks are recorded separately in the JSON.", "",
    "## Page extraction matrix", "", "| Route | Surface | Implementation state | Original presentation boundary | Direct loaders / guards |", "| --- | --- | --- | --- | --- |",
    ...pages.map((page) => `| \`${page.route}\` | ${page.surface} | ${page.implementation.status} | ${page.extraction} | ${join(page.directCalls)} |`),
    "", "## HTTP route handlers", "", "Completion is endpoint-specific: GET readiness, authoritative transaction, job acceptance and provider delivery are separate events. The listed calls identify review entry points, not proof that all downstream checks execute on every path.", "",
    "| Source | Methods | Implementation state | Calls to review |", "| --- | --- | --- | --- |",
    ...handlers.map((handler) => `| \`${handler.file}\` | ${join(handler.methods)} | ${handler.implementation} | ${join(handler.directCalls)} |`),
    "", "## Server actions", "", "Each exported or inline action is listed independently. Detailed guards/tables are available by source in the JSON. Before migrating an action, classify its irreversible transitions, external effects, expected version and idempotency requirements. This list does not claim every action received a new command transport. Appointment draft/submit and relationship background commands are the implemented gated command paths; OKR modal deletion now has an inline response with its existing server authority and a conditional draft-only delete. Other action implementations retain their existing behavior unless specifically described in the PR.", "",
    "| Source | Action | Boundary |", "| --- | --- | --- |",
    ...actions.map((action) => `| \`${action.file}${action.line ? `:${action.line}` : ""}\` | \`${action.name}\` | ${action.kind} |`),
    "", "## Migration completion recording", "",
    "Record implementation and measured evidence in `docs/workspace-performance-revamp-plan.md` and the PR. Do not replace unresolved matrix rows with blanket certification. A route with an extracted client view still needs authorization, deep-link/history, view-state, pending-edit and meaningful-paint checks.", "",
]
const out = process.argv[2] ?? "docs/workspace-performance-inventory"
if (!existsSync(path.dirname(path.resolve(out)))) throw new Error("Output directory must already exist")
writeFileSync(`${out}.json`, `${JSON.stringify(report, null, 2)}\n`)
writeFileSync(`${out}.md`, lines.join("\n"))
console.log(JSON.stringify({ pages: pages.length, handlers: handlers.length, actions: actions.length, output: out }))
