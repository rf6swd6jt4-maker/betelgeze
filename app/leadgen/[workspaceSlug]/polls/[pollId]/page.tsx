import { redirect } from "next/navigation"

type PageProps = { params: Promise<{ workspaceSlug: string; pollId: string }> }

export default async function LegacyLeadgenPollDetailPage({ params }: PageProps) {
    const { workspaceSlug, pollId } = await params
    redirect(`https://leadgen.betelgeze.com/${workspaceSlug}/poll/${pollId}`)
}
