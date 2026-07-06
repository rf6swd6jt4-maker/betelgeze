import { redirect } from "next/navigation"

type PageProps = { params: Promise<{ workspaceSlug: string; pollId: string }> }

export default async function LegacyLeadgenPollDetailPage({ params }: PageProps) {
    const { workspaceSlug, pollId } = await params
    redirect(`/${workspaceSlug}/leadgen/poll/${pollId}`)
}
