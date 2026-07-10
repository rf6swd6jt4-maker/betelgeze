import { redirect } from "next/navigation"

export const dynamic = "force-dynamic"
type PageProps = { params: Promise<{ workspaceSlug: string }> }

export default async function UsersPage({ params }: PageProps) {
    const { workspaceSlug } = await params
    redirect(`/${workspaceSlug}/settings`)
}
