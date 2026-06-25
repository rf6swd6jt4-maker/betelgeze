"use client"

import Link from "next/link"
import { Suspense } from "react"
import { useSearchParams } from "next/navigation"
import { BrandLockup } from "@/components/brand/BrandLockup"

function ConfirmedScreen() {
    const searchParams = useSearchParams()
    const email = searchParams.get("email") ?? ""
    const invite = searchParams.get("invite")
    const failed = searchParams.get("error") === "confirmation_failed"
    const confirmedWithoutSession = searchParams.get("status") === "confirmed"
    const loginHref = `https://auth.betelgeze.com/login${invite ? `?invite=${encodeURIComponent(invite)}` : ""}`
    return <main className="flex min-h-screen items-center justify-center bg-neutral-950 px-6 text-white"><section className="w-full max-w-sm rounded-2xl border border-neutral-800 bg-neutral-900 p-7"><BrandLockup compact /><h1 className="mt-5 text-2xl font-semibold">{failed ? "This confirmation link needs a fresh start" : "Email confirmed"}</h1><p className="mt-3 text-neutral-300">{failed ? "The link may have expired or already been used. Log in to request a new confirmation email." : confirmedWithoutSession ? "Your email is confirmed. Log in to continue setting up your account." : `Thank you for confirming ${email || "your email"}. You can log in to your account now.`}</p><Link href={loginHref} className="mt-6 inline-block rounded-lg bg-white px-4 py-3 font-medium text-black">Log in</Link></section></main>
}

export default function ConfirmedPage() { return <Suspense fallback={null}><ConfirmedScreen /></Suspense> }
