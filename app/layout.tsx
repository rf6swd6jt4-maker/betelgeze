import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import { Geist, Geist_Mono } from "next/font/google";
import { GlobalLoadingOverlay } from "@/components/GlobalLoadingOverlay";
import { ServiceWorkerRegistrar } from "@/components/pwa/ServiceWorkerRegistrar";
import { WorkspaceTabFrameGuard } from "@/components/workspace/WorkspaceTabFrameGuard";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  applicationName: "Betelgeze",
  metadataBase: new URL("https://betelgeze.com"),
  title: "Betelgeze",
  description: "Business automation dashboards",
  icons: {
    icon: "/icon.svg?v=20260624",
    shortcut: "/icon.svg?v=20260624",
    apple: {
      url: "/apple-icon.png?v=20260624",
      sizes: "180x180",
      type: "image/png",
    },
  },
  formatDetection: {
    telephone: false,
  },
};

export const viewport: Viewport = {
  colorScheme: "dark",
  themeColor: "#0a0a0a",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <Suspense fallback={null}>
          <WorkspaceTabFrameGuard />
        </Suspense>
        {children}
        <ServiceWorkerRegistrar />
        <Suspense fallback={null}>
          <GlobalLoadingOverlay />
        </Suspense>
      </body>
    </html>
  );
}
