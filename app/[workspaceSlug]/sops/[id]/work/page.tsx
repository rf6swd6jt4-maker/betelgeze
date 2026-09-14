import { redirect } from "next/navigation"
export default async function RetiredWorkReport({ params }: { params: Promise<{ workspaceSlug: string; id: string }> }) {
    const { workspaceSlug, id } = await params
    redirect(`/${workspaceSlug}/sops/${id}`)
}
