// The client's page in the Today layout (docs/today-layout.md, "Client page"): one home per client, with a tab for
// each thing that belongs to them. The tabs are sections of the relationship page, so the client is one resident
// destination and no frame is involved.
// @ts-expect-error Node's built-in TypeScript test runner requires the source extension.
import { relationshipContextHref, type RelationshipContextDestination } from "./relationship-context.ts"

export type ClientPageTabKey = "overview" | "work" | "onboarding" | "connections" | "files"
export type ClientPageTab = { key: ClientPageTabKey; label: string; href: string; /** A shorter name for a phone's tab strip. */ shortLabel?: string }

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const SECTION_KEYS: readonly ClientPageTabKey[] = ["work", "onboarding", "connections", "files"]

/**
 * The tabs a person may open for one client. For someone who can open the relationship page they are sections of
 * that one page (`?tab=`), so switching is in place: nothing new is mounted in the shell and each section reads once,
 * the first time it is opened. Someone who cannot open the relationship page keeps the standalone pages they may open.
 */
export function clientPageTabs(workspaceSlug: string, relationshipId: string, allowed: readonly RelationshipContextDestination[] = []): ClientPageTab[] {
    const page = relationshipContextHref("relationships", workspaceSlug, relationshipId)
    const inPage = allowed.includes("relationships")
    const tabs: ClientPageTab[] = []
    if (inPage) tabs.push({ key: "overview", label: "Overview", href: page })
    if (allowed.includes("fulfilment")) tabs.push({ key: "work", label: "Work", href: inPage ? `${page}?tab=work` : relationshipContextHref("fulfilment", workspaceSlug, relationshipId) })
    if (allowed.includes("onboarding")) tabs.push({ key: "onboarding", label: "Onboarding", href: inPage ? `${page}?tab=onboarding` : relationshipContextHref("onboarding", workspaceSlug, relationshipId) })
    if (allowed.includes("client-connections")) tabs.push({ key: "connections", label: "Connections", href: inPage ? `${page}?tab=connections` : relationshipContextHref("client-connections", workspaceSlug, relationshipId) })
    if (inPage) tabs.push({ key: "files", label: "Files and notes", shortLabel: "Files", href: `${page}?tab=files` })
    return tabs
}

/** The section of the relationship page a `?tab=` value names; anything else is the Overview. */
export function clientPageSection(tab: string | null | undefined): ClientPageTabKey {
    return SECTION_KEYS.find(key => key === tab) ?? "overview"
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
    if (kind === "relationships") return clientPageSection(url.searchParams.get("tab"))
    return null
}
