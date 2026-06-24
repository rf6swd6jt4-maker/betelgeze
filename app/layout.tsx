import type { Metadata } from "next";
import { Suspense } from "react";
import { Geist, Geist_Mono } from "next/font/google";
import { GlobalLoadingOverlay } from "@/components/GlobalLoadingOverlay";
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
  title: "Betelgeze",
  description: "Business automation dashboards",
  icons: {
    icon: "/icon.svg?v=20260624",
    shortcut: "/icon.svg?v=20260624",
    apple: "/icon.svg?v=20260624",
  },
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
        {children}
        <Suspense fallback={null}>
          <GlobalLoadingOverlay />
        </Suspense>
      </body>
    </html>
  );
}
