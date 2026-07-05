import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { InstallPrompt } from "@/components/pwa/InstallPrompt";

export const metadata: Metadata = {
  title: "Install Betelgeze",
  description: "Install Betelgeze as an app on Apple, Android, Windows, and desktop devices.",
};

export default function InstallPage() {
  return (
    <main className="min-h-screen bg-neutral-950 px-5 py-6 text-white sm:px-6 sm:py-10">
      <div className="mx-auto max-w-5xl">
        <nav className="flex items-center justify-between">
          <Link href="/" className="inline-flex items-center gap-2 text-sm font-semibold text-white">
            <Image src="/brand/betelgeze-logo-inverted-no-background.svg" alt="Betelgeze" width={32} height={32} priority />
            <span>Betelgeze</span>
          </Link>
          <Link href="https://auth.betelgeze.com/login?next=https%3A%2F%2Fapp.betelgeze.com%2F" className="rounded-lg border border-neutral-700 px-3 py-2 text-sm text-neutral-200 hover:border-neutral-400">
            Log in
          </Link>
        </nav>

        <section className="grid gap-8 py-14 lg:grid-cols-[0.9fr_1.1fr] lg:items-end lg:py-20">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-300">Betelgeze app</p>
            <h1 className="mt-4 max-w-3xl text-4xl font-semibold tracking-tight sm:text-6xl">Install the agency operating system.</h1>
          </div>
          <p className="max-w-2xl text-base leading-7 text-neutral-300">
            Add Betelgeze to your home screen, Dock, taskbar, or app launcher. This first installable version keeps the live platform online in the browser while giving the team one app entry point.
          </p>
        </section>

        <InstallPrompt />

        <section className="mt-6 grid gap-3 sm:grid-cols-3">
          {[
            ["One entry point", "Open the internal platform from the app origin."],
            ["Safe caching", "Static app assets only; live client data stays fresh."],
            ["Notification-ready", "The service worker is in place for future workflow alerts."],
          ].map(([title, body]) => (
            <div key={title} className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
              <p className="text-sm font-semibold text-white">{title}</p>
              <p className="mt-2 text-sm leading-6 text-neutral-400">{body}</p>
            </div>
          ))}
        </section>
      </div>
    </main>
  );
}
