import { redirect } from "next/navigation"

export const dynamic = "force-dynamic"

type PageProps = { params: Promise<{ workspaceSlug: string }> }

export default async function LegacyNewLeadgenPollPage({ params }: PageProps) {
    const { workspaceSlug } = await params
    redirect(`https://leadgen.betelgeze.com/${workspaceSlug}/new`)
}
