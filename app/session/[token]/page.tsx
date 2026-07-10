import { redirect } from "next/navigation"

type PageProps = {
    params: Promise<{ token: string }>
}

export default async function LegacySessionRedirect({ params }: PageProps) {
    const { token } = await params
    redirect(`/onboarding/session/${token}`)
}
