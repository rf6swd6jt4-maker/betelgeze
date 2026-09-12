import { GoogleAdsAccountPicker } from "@/components/google-ads/GoogleAdsAccountPicker"
export const dynamic = "force-dynamic"
export const metadata = { title: "Connect Google Ads", robots: { index: false, follow: false }, referrer: "no-referrer" }
export default async function Page({ params }: { params: Promise<{ state: string }> }) {
    const { state } = await params
    return <GoogleAdsAccountPicker state={state} />
}
