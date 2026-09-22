import { redirect } from "next/navigation"
import { requireWorkspacePanel } from "@/lib/workspace-access"

export default async function LegacyAppointmentSettingPage({ params }: { params: Promise<{ workspaceSlug: string }> }) {
    const { workspaceSlug } = await params
    await requireWorkspacePanel(workspaceSlug, "client-connections")
    redirect(`/${workspaceSlug}/client-connections`)
}
