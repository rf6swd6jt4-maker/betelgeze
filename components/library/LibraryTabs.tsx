import { PanelTabs } from "@/components/panel/PanelTabs"

export function LibraryTabs({ workspaceSlug, active, sopOnly = false }: { workspaceSlug: string; active: "work-items" | "assets" | "sops"; sopOnly?: boolean }) {
    const sops = { key: "sops", label: "SOPs", href: `/${workspaceSlug}/sops` }
    const items = sopOnly ? [sops] : [
        { key: "work-items", label: "Work Items", href: `/${workspaceSlug}/work-items` },
        sops,
        { key: "assets", label: "Assets", href: `/${workspaceSlug}/assets` },
    ]
    return <PanelTabs items={items} active={active} ariaLabel="Library panel" />
}
