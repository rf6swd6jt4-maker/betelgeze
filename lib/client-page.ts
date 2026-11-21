// The client's page in the Today layout (docs/today-layout.md, "Client page"): one home per client, with a tab for
// each thing that belongs to them. Every tab is an existing route, so opening one is ordinary navigation inside the
// client's resident destination: no new frame, read or cache.
// @ts-expect-error Node's built-in TypeScript test runner requires the source extension.
import { relationshipContextHref, type RelationshipContextDestination } from "./relationship-context.ts"

export type ClientPageTabKey = "overview" | "work" | "onboarding" | "connections" | "files"
export type ClientPageTab = { key: ClientPageTabKey; label: string; href: string }

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * The tabs a person may open for one client. Overview and Files and notes are the relationship page itself; the rest
 * follow the destinations the person is allowed to open for this relationship (the same list the client column used).
 */
export function clientPageTabs(workspaceSlug: string, relationshipId: string, allowed: readonly RelationshipContextDestination[] = []): ClientPageTab[] {
    const overview = relationshipContextHref("relationships", workspaceSlug, relationshipId)
    const tabs: ClientPageTab[] = []
    if (allowed.includes("relationships")) tabs.push({ key: "overview", label: "Overview", href: overview })
    if (allowed.includes("fulfilment")) tabs.push({ key: "work", label: "Work", href: relationshipContextHref("fulfilment", workspaceSlug, relationshipId) })
    if (allowed.includes("onboarding")) tabs.push({ key: "onboarding", label: "Onboarding", href: relationshipContextHref("onboarding", workspaceSlug, relationshipId) })
    if (allowed.includes("client-connections")) tabs.push({ key: "connections", label: "Connections", href: relationshipContextHref("client-connections", workspaceSlug, relationshipId) })
    if (allowed.includes("relationships")) tabs.push({ key: "files", label: "Files and notes", href: `${overview}?tab=files` })
    return tabs
}

/**
 * The client a URL is a page of, or null: their relationship page, their work, onboarding or appointment-setting
 * page, or Client Connections narrowed to them. A work item, asset or note that belongs to a client is a record, not
 * one of the client's pages.
 */
export function clientPageRelationshipId(value: string, workspaceSlug: string): string | null {
    let url: URL
    try { url = new URL(value, "http://workspace.invalid") } catch { return null }
    const path = url.pathname.replace(/\/$/, "")
    if (!path.startsWith(`/${workspaceSlug}/`)) return null
    const [kind, id, ...rest] = path.slice(workspaceSlug.length + 2).split("/")
    if (kind === "client-connections") {
        const relationship = url.searchParams.get("relationship")
        return !id && relationship && uuid.test(relationship) ? relationship : null
    }
    if (!id || !uuid.test(id)) return null
    if (kind === "relationships") return rest.length === 0 || (rest.length === 1 && rest[0] === "pos") ? id : null
    return (kind === "work" || kind === "onboarding" || kind === "appointment-setting") && rest.length === 0 ? id : null
}

/** Which tab of the client's page a URL shows. */
export function clientPageActiveTab(value: string, workspaceSlug: string): ClientPageTabKey | null {
    if (!clientPageRelationshipId(value, workspaceSlug)) return null
    const url = new URL(value, "http://workspace.invalid")
    const kind = url.pathname.slice(workspaceSlug.length + 2).split("/")[0]
    if (kind === "work") return "work"
    if (kind === "onboarding") return "onboarding"
    if (kind === "client-connections") return "connections"
    if (kind === "relationships") return url.searchParams.get("tab") === "files" ? "files" : "overview"
    return null
}
