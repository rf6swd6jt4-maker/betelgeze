import { SiteHeader } from "@/components/marketing/SiteHeader"
import Link from "next/link"

export default function Home() {
    return <main className="min-h-screen bg-neutral-950 text-white"><SiteHeader /><section className="mx-auto flex min-h-[calc(100vh-8rem)] max-w-3xl items-center justify-center px-6 py-20 text-center"><div><p className="text-sm text-neutral-400">A calmer operating system for client work.</p><h1 className="mt-4 text-4xl font-semibold tracking-tight sm:text-6xl">Business automation, made calmer.</h1><p className="mx-auto mt-5 max-w-xl text-base leading-7 text-neutral-300 sm:text-lg">A private home for client onboarding, operational work, and the systems that keep both moving.</p></div></section><footer className="flex flex-wrap justify-center gap-x-6 gap-y-2 border-t border-neutral-800 px-6 py-5 text-sm text-neutral-400"><Link href="/privacy" className="underline underline-offset-4 hover:text-white">Privacy Policy</Link><Link href="/terms" className="underline underline-offset-4 hover:text-white">Terms and Conditions</Link><a href="mailto:support@betelgeze.com" className="underline underline-offset-4 hover:text-white">Contact</a></footer></main>
}
