import { PanelTabs } from "@/components/panel/PanelTabs"

export function LibraryTabs({ workspaceSlug, active, limited = false }: { workspaceSlug: string; active: "work-items" | "assets" | "sops"; limited?: boolean }) {
    const sops = { key: "sops", label: "SOPs", href: `/${workspaceSlug}/sops` }
    const workItems = { key: "work-items", label: "Work Items", href: `/${workspaceSlug}/work-items` }
    const items = limited ? [workItems, sops] : [
        workItems,
        sops,
        { key: "assets", label: "Assets", href: `/${workspaceSlug}/assets` },
    ]
    return <PanelTabs items={items} active={active} ariaLabel="Library panel" />
}
