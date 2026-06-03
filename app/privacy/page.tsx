import Link from "next/link"
import type { Metadata } from "next"

export const metadata: Metadata = {
    title: "Privacy Policy | ScaylUp",
    description:
        "Privacy policy for ScaylUp onboarding and client communication.",
}

const SECTIONS = [
    {
        title: "Information We Collect",
        body: [
            "We collect information clients provide during onboarding, including name, email address, WhatsApp number, business information, project requirements, uploaded files, form responses, and messages sent to our team.",
            "We may also collect technical information needed to operate the portal, such as timestamps, progress status, session identifiers, and delivery or webhook records for client communications.",
        ],
    },
    {
        title: "How We Use Information",
        body: [
            "We use client information to provide onboarding, prepare and deliver agency services, communicate about active projects, manage client requests, maintain internal records, and improve our fulfilment process.",
            "We do not sell client personal information.",
        ],
    },
    {
        title: "WhatsApp Communications",
        body: [
            "If a client communicates with us through WhatsApp, messages may be processed through Meta WhatsApp Business Platform and routed into our internal project communication tools so our team can respond and keep a transparent record of project conversations.",
            "Clients should not send sensitive information through WhatsApp unless it is necessary for the project.",
        ],
    },
    {
        title: "Service Providers",
        body: [
            "We use trusted service providers to operate our systems, including hosting, database, file storage, project management, analytics, and communication providers. These providers process information only as needed to support our services.",
            "Examples may include Vercel, Supabase, Cloudflare R2, ClickUp, Meta WhatsApp Business Platform, and similar operational tools.",
        ],
    },
    {
        title: "Data Retention",
        body: [
            "We keep client information for as long as needed to provide services, maintain project records, comply with legal obligations, resolve disputes, and support legitimate business operations.",
            "Clients may request deletion of information where applicable, subject to records we must keep for legal, security, or business reasons.",
        ],
    },
    {
        title: "Security",
        body: [
            "We use reasonable technical and organizational safeguards to protect client information. No online system is completely secure, but we work to limit access to authorized team members and service providers who need the information for business purposes.",
        ],
    },
    {
        title: "Client Choices",
        body: [
            "Clients can ask us to correct, update, export, or delete personal information where applicable. Clients can also stop messaging us on WhatsApp at any time.",
        ],
    },
    {
        title: "Changes To This Policy",
        body: [
            "We may update this Privacy Policy from time to time. The updated version will be posted on this page with a new effective date.",
        ],
    },
]

export default function PrivacyPage() {
    return (
        <main className="min-h-screen bg-[#F8F7F3] px-5 py-8 text-slate-900 sm:px-6 sm:py-12">
            <article className="mx-auto max-w-3xl rounded-lg border border-slate-200 bg-white p-6 shadow-sm sm:p-10">
                <Link
                    href="/"
                    className="text-sm font-medium text-[#1E3A5F] hover:underline"
                >
                    ScaylUp
                </Link>

                <h1 className="mt-6 text-3xl font-semibold tracking-tight sm:text-4xl">
                    Privacy Policy
                </h1>

                <p className="mt-3 text-sm text-slate-500">
                    Effective date: 3 June 2026
                </p>

                <p className="mt-6 leading-7 text-slate-700">
                    This Privacy Policy explains how ScaylUp collects, uses,
                    stores, and shares information when clients use our
                    onboarding portal, communicate with our team, or receive
                    agency services.
                </p>

                <div className="mt-8 space-y-8">
                    {SECTIONS.map((section) => (
                        <section key={section.title}>
                            <h2 className="text-xl font-semibold text-slate-950">
                                {section.title}
                            </h2>

                            <div className="mt-3 space-y-3">
                                {section.body.map((paragraph) => (
                                    <p
                                        key={paragraph}
                                        className="leading-7 text-slate-700"
                                    >
                                        {paragraph}
                                    </p>
                                ))}
                            </div>
                        </section>
                    ))}
                </div>

                <section className="mt-8 border-t border-slate-200 pt-8">
                    <h2 className="text-xl font-semibold text-slate-950">
                        Contact
                    </h2>

                    <p className="mt-3 leading-7 text-slate-700">
                        For privacy questions or requests, contact ScaylUp using
                        the contact details provided to you as a client, or
                        message our team through your active project
                        communication channel.
                    </p>
                </section>
            </article>
        </main>
    )
}
