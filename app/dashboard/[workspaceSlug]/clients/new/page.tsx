import { redirect } from "next/navigation"
import { workspaceHref } from "@/lib/relationships"

type PageProps = { params: Promise<{ workspaceSlug: string }> }

export default async function NewWorkspaceClientPage({ params }: PageProps) {
    const { workspaceSlug } = await params
    redirect(workspaceHref(workspaceSlug, "relationships/new"))
}
