import { PanelTabs } from "@/components/panel/PanelTabs"

export function LibraryTabs({ workspaceSlug, active, sopOnly = false }: { workspaceSlug: string; active: "work-items" | "assets" | "sops"; sopOnly?: boolean }) {
    return <PanelTabs items={[
        { key: "sops", label: "SOPs", href: `/${workspaceSlug}/sops` },
        ...(!sopOnly ? [
        { key: "work-items", label: "Work Items", href: `/${workspaceSlug}/work-items` },
        { key: "assets", label: "Assets", href: `/${workspaceSlug}/assets` },
        ] : []),
    ]} active={active} ariaLabel="Library panel" />
}
