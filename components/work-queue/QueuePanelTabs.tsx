import { PanelTabs } from "@/components/panel/PanelTabs"

/** Work Queue tabs. "Needs attention" is team-wide and shown only to owners and admins. */
export function QueuePanelTabs({ workspaceSlug, active }: { workspaceSlug: string; active: "queue" | "attention" }) {
    const items = [
        { key: "queue", label: "Work Queue", href: `/${workspaceSlug}/queue` },
        { key: "attention", label: "Needs attention", href: `/${workspaceSlug}/queue/attention` },
    ] as const
    return <PanelTabs items={items} active={active} ariaLabel="Work Queue panel" />
}
