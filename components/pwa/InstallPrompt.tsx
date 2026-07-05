"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";

type Platform = "ios" | "android" | "mac" | "windows" | "desktop" | "unknown";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

const instructions: Record<Platform, { title: string; steps: string[] }> = {
  ios: {
    title: "Install on iPhone or iPad",
    steps: ["Open this page in Safari.", "Tap Share.", "Choose Add to Home Screen."],
  },
  android: {
    title: "Install on Android",
    steps: ["Use the install button when it appears.", "Or open the browser menu.", "Choose Install app or Add to Home screen."],
  },
  mac: {
    title: "Install on Mac",
    steps: ["In Safari, choose File then Add to Dock.", "In Chrome or Edge, use the install icon in the address bar.", "Keep Betelgeze pinned in the Dock for quick access."],
  },
  windows: {
    title: "Install on Windows",
    steps: ["Use the install button when it appears.", "Or use the Edge or Chrome install icon in the address bar.", "Pin Betelgeze to the taskbar after install."],
  },
  desktop: {
    title: "Install on desktop",
    steps: ["Open this page in Chrome, Edge, or Safari.", "Use the browser install option.", "Launch Betelgeze from your app launcher or Dock."],
  },
  unknown: {
    title: "Install Betelgeze",
    steps: ["Open this page in a modern browser.", "Use the browser install option.", "Launch Betelgeze like a normal app."],
  },
};

function detectPlatform(): Platform {
  const userAgent = window.navigator.userAgent.toLowerCase();
  const platform = window.navigator.platform?.toLowerCase() ?? "";
  const isTouchMac = platform === "macintel" && window.navigator.maxTouchPoints > 1;

  if (/iphone|ipad|ipod/.test(userAgent) || isTouchMac) return "ios";
  if (/android/.test(userAgent)) return "android";
  if (/win/.test(platform)) return "windows";
  if (/mac/.test(platform)) return "mac";
  if (/linux|x11/.test(platform)) return "desktop";
  return "unknown";
}

function isStandalone() {
  const navigatorWithStandalone = window.navigator as Navigator & { standalone?: boolean };
  return window.matchMedia("(display-mode: standalone)").matches || navigatorWithStandalone.standalone === true;
}

function subscribeNoop() {
  return () => {};
}

function platformSnapshot(): Platform {
  return typeof window === "undefined" ? "unknown" : detectPlatform();
}

function serverPlatformSnapshot(): Platform {
  return "unknown";
}

function standaloneSnapshot(): boolean {
  return typeof window !== "undefined" && isStandalone();
}

function subscribeStandalone(callback: () => void) {
  if (typeof window === "undefined") return () => {};
  const media = window.matchMedia("(display-mode: standalone)");
  media.addEventListener("change", callback);
  window.addEventListener("appinstalled", callback);
  return () => {
    media.removeEventListener("change", callback);
    window.removeEventListener("appinstalled", callback);
  };
}

export function InstallPrompt() {
  const platform = useSyncExternalStore<Platform>(subscribeNoop, platformSnapshot, serverPlatformSnapshot);
  const standalone = useSyncExternalStore(subscribeStandalone, standaloneSnapshot, () => false);
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installedByPrompt, setInstalledByPrompt] = useState(false);
  const [status, setStatus] = useState("Ready when your browser is.");

  useEffect(() => {
    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
      setStatus("This browser can install Betelgeze directly.");
    };
    const handleInstalled = () => {
      setInstalledByPrompt(true);
      setDeferredPrompt(null);
      setStatus("Betelgeze is installed on this device.");
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleInstalled);
    };
  }, []);

  const installed = standalone || installedByPrompt;
  const installCopy = useMemo(() => instructions[platform], [platform]);
  const canPrompt = Boolean(deferredPrompt) && !installed;
  const displayStatus = installed ? "Betelgeze is installed on this device." : status;

  async function install() {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;
    setDeferredPrompt(null);
    setStatus(choice.outcome === "accepted" ? "Finishing installation." : "Installation dismissed. You can try again from the browser menu.");
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[0.95fr_1.05fr] lg:items-start">
      <section className="rounded-lg border border-neutral-800 bg-neutral-950 p-5">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-300">Install status</p>
        <h2 className="mt-3 text-2xl font-semibold tracking-tight">
          {installed ? "Betelgeze is running as an app." : installCopy.title}
        </h2>
        <p className="mt-3 text-sm leading-6 text-neutral-400">{displayStatus}</p>
        <button
          type="button"
          onClick={install}
          disabled={!canPrompt}
          className="mt-6 w-full rounded-lg bg-white px-4 py-3 text-sm font-semibold text-black transition hover:bg-neutral-200 disabled:cursor-not-allowed disabled:bg-neutral-800 disabled:text-neutral-500"
        >
          {installed ? "Installed" : canPrompt ? "Install Betelgeze" : "Use browser install"}
        </button>
      </section>

      <section className="border-t border-neutral-800 pt-5 lg:border-l lg:border-t-0 lg:pl-5 lg:pt-0">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-neutral-500">This device</p>
        <ol className="mt-4 grid gap-3">
          {installCopy.steps.map((step, index) => (
            <li key={step} className="flex gap-3 border-b border-neutral-800 pb-3 text-sm leading-6 text-neutral-300 last:border-b-0">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-neutral-800 text-xs font-semibold text-white">{index + 1}</span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
