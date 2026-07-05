"use client"
import Link from "next/link"
import { BrandLockup } from "@/components/brand/BrandLockup"
export function InvitationChoices({ valid, workspaceName, email, token }: { valid: boolean; workspaceName: string; email: string; token: string }) {
 if(!valid) return <main className="flex min-h-screen items-center justify-center bg-neutral-950 px-6 text-white"><div className="w-full max-w-md rounded-2xl border border-neutral-800 bg-neutral-900 p-7"><BrandLockup compact /><h1 className="mt-5 text-2xl font-semibold">Invitation unavailable</h1><p className="mt-3 text-neutral-400">This invitation is invalid, accepted, or has expired.</p></div></main>
 const query=`invite=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}`
 return <main className="flex min-h-screen items-center justify-center bg-neutral-950 px-6 text-white"><div className="w-full max-w-md rounded-2xl border border-neutral-800 bg-neutral-900 p-7"><BrandLockup compact /><h1 className="mt-5 text-2xl font-semibold">You’ve been invited to {workspaceName}&apos;s workspace</h1><p className="mt-3 text-neutral-300">Continue with the invited email: <strong>{email}</strong>.</p><div className="mt-7 grid gap-3"><Link href={`/login?${query}`} className="rounded-lg bg-white px-4 py-3 text-center font-medium text-black">Log in</Link><Link href={`/sign-up?${query}`} className="rounded-lg border border-neutral-600 px-4 py-3 text-center font-medium text-white">Create an account</Link></div></div></main>
}
