import type { Metadata } from "next";
import { headers } from "next/headers";
import Image from "next/image";
import Link from "next/link";
import { InstallPrompt } from "@/components/pwa/InstallPrompt";
import { Button, Card } from "@/components/ui";

const appOrigin = "https://app.betelgeze.com";
const appInstallUrl = `${appOrigin}/install`;

function hostnameFromHeaders(requestHeaders: Headers) {
  return (requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "").split(":")[0].toLowerCase();
}

export async function generateMetadata(): Promise<Metadata> {
  const isAppHost = hostnameFromHeaders(await headers()) === "app.betelgeze.com";
  const metadata: Metadata = {
    applicationName: "Betelgeze",
    metadataBase: new URL(appOrigin),
    title: "Install Betelgeze",
    description: "Install Betelgeze as an app on Apple, Android, Windows, and desktop devices.",
  };

  if (!isAppHost) return metadata;

  return {
    ...metadata,
    manifest: "/manifest.webmanifest",
    appleWebApp: {
      capable: true,
      title: "Betelgeze",
      statusBarStyle: "black-translucent",
    },
    other: {
      "mobile-web-app-capable": "yes",
    },
  };
}

export default async function InstallPage() {
  const isAppHost = hostnameFromHeaders(await headers()) === "app.betelgeze.com";
  const loginHref = `${appOrigin}/login?next=${encodeURIComponent(`${appOrigin}/`)}`;

  return (
    <main className="min-h-screen bg-neutral-950 px-5 py-6 text-white sm:px-6 sm:py-10">
      <div className="mx-auto max-w-5xl">
        <nav className="flex items-center justify-between">
          <Link href="/" className="inline-flex items-center gap-2 text-sm font-semibold text-white">
            <Image src="/brand/betelgeze-logo-inverted-no-background.svg" alt="Betelgeze" width={32} height={32} priority />
            <span>Betelgeze</span>
          </Link>
          <Button href={loginHref} variant="secondary" size="sm">
            Log in
          </Button>
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

        {isAppHost ? (
          <InstallPrompt />
        ) : (
          <Card>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-300">App domain required</p>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight">Open the app domain before installing.</h2>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-neutral-400">
              Safari installs the current website. Use the app domain so the Dock icon opens the Betelgeze app, not the marketing site.
            </p>
            <Button href={appInstallUrl} className="mt-6">
              Open app install page
            </Button>
          </Card>
        )}

        <section className="mt-6 grid gap-3 sm:grid-cols-3">
          {[
            ["One entry point", "Open the internal platform from the app origin."],
            ["Safe caching", "Static app assets only; live client data stays fresh."],
            ["Notification-ready", "The service worker is in place for future workflow alerts."],
          ].map(([title, body]) => (
            <Card key={title} padding="sm">
              <p className="text-sm font-semibold text-white">{title}</p>
              <p className="mt-2 text-sm leading-6 text-neutral-400">{body}</p>
            </Card>
          ))}
        </section>
      </div>
    </main>
  );
}
