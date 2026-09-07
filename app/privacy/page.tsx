import Link from "next/link"
import type { Metadata } from "next"

export const metadata: Metadata = {
    title: "Privacy Policy | Betelgeze",
    description:
        "How Betelgeze handles platform, messaging, and connected Google Ads data, including access, use, sharing, retention, and deletion.",
    alternates: { canonical: "https://www.betelgeze.com/privacy" },
}

const SECTIONS = [
    {
        title: "Betelgeze and Your Agency",
        body: [
            "Betelgeze provides software for agency workspaces, client onboarding, project operations, communications, and client portals. The agency providing your services is identified in your workspace, onboarding experience, or messages. That agency determines the services it delivers and who on its team should have access to your project information; Betelgeze processes that information to operate the platform.",
            "This policy covers Betelgeze's handling of information. Your agency's own privacy notice and service agreement also apply to its use of your information. Connecting an advertising account does not give other, unrelated agencies access to it through Betelgeze.",
        ],
    },
    {
        title: "Information We Collect",
        body: [
            "We collect information clients provide during onboarding, including name, email address, mobile and WhatsApp numbers, business information, project requirements, uploaded files, form responses, communication preferences, and messages sent to an agency through Betelgeze.",
            "We may also collect technical information needed to operate the portal, such as timestamps, progress status, session identifiers, message delivery records, webhook records, and records of SMS consent or opt-out requests.",
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
        title: "Connected Meta Business Portfolios",
        body: [
            "A workspace owner may connect an agency-owned Meta Business Portfolio to Betelgeze, and a client may connect Facebook during onboarding for a specific agency relationship. During connection, Meta may provide the Facebook user's name and identifier, the Business Portfolios and advertising accounts they can access, portfolio and account identifiers and names, business verification status, granted permissions, and a time-limited access token. Betelgeze encrypts the token and does not return it to the browser.",
            "Betelgeze uses this connection only to verify portfolio access and, when enabled in the portal, read advertising account and campaign reporting data for agency services. The initial connection requests read-only advertising access and does not give Betelgeze permission to create or change ads.",
            "A workspace owner can disconnect Meta Ads in Workspace Settings. To request deletion of stored Meta connection data, email support@betelgeze.com from the workspace owner's account and identify the workspace. We will delete the stored token and connection metadata unless retention is required for security, legal, or audit purposes.",
        ],
    },
    {
        title: "Google Ads Data We Access and Store",
        body: [
            "When an agency connects Google Ads, its workspace owner provides a Google Ads manager account ID, developer token, and Google Cloud service-account credentials. Betelgeze stores these credentials encrypted and uses them on its servers to authenticate with Google. Clients do not need to provide their Google password or a private key during onboarding.",
            "When you connect an advertising account, we collect the customer ID you enter and your confirmation that you are authorized to connect it. Through the Google Ads API, we check account identifiers and names, manager relationships, account status, invitation status, currency, and time zone. We store the connection's relationship and workspace identifiers, status, verification timestamps, and limited diagnostic information needed to support it.",
            "Google Ads performance reporting is being developed. When available and enabled for your account, it will access account and campaign identifiers, names, and performance metrics such as impressions, clicks, spend, conversions, and conversion value over selected dates. Reporting data and summaries may be stored to display results in your client portal. Describing that planned feature here does not mean it is currently collecting performance metrics.",
        ],
    },
    {
        title: "How We Use and Share Google Ads Data",
        body: [
            "We use Google Ads information to link the account you select to the agency you authorize, check whether access has been approved, save your onboarding progress, diagnose connection failures, and provide the advertising reports you enable. Creating a pending manager invitation is an action taken with Google; it does not complete the connection until an authorized user approves it in Google Ads. Existing agency access may be verified without a new invitation.",
            "Connection information and, when enabled, reports are available to you and authorized members of the agency workspace responsible for your services. By connecting your account, you authorize this access for those purposes. Betelgeze personnel may access specific information with your permission for support, or where necessary for security or legal obligations. Hosting and database providers process data as needed to operate these features, and Google receives the account identifiers and API requests required to perform them.",
            "We do not sell Google API data, disclose it to data brokers, use it for unrelated advertising or cross-client profiling, or use it to train general-purpose AI or machine-learning models. We do not share it with unrelated agency workspaces. Transfers are limited to the features you authorize, necessary security purposes, or legal obligations. Any transfer as part of a business acquisition remains subject to applicable Google data-use restrictions and required consent.",
            <>Betelgeze complies with the <a href="https://developers.google.com/terms/api-services-user-data-policy" className="font-medium text-[#1E3A5F] underline underline-offset-2">Google API Services User Data Policy</a>, including the applicable Limited Use requirements, when using or transferring information received from Google APIs. We will disclose material changes in Google data use and obtain any required additional consent before using that data for a new purpose.</>,
        ],
    },
    {
        title: "Disconnecting Google Ads and Deleting Data",
        body: [
            "An agency workspace owner can disconnect Google Ads in Settings > Connections. This disables the integration and removes its stored active, pending, and rollback credentials from the workspace integration record. Disconnecting Betelgeze does not unlink the agency's manager account inside Google Ads, cancel campaigns, or delete records held by Google.",
            "To withdraw the agency's manager access, use Google Ads > Admin > Access and security > Managers to remove the manager link, subject to Google's account requirements. The agency can also remove the service account's access under Users or revoke its key in Google Cloud. These controls are separate from deleting information already stored by Betelgeze.",
            "To request deletion of stored Google Ads connection information or reports, contact support@betelgeze.com and identify your agency workspace and advertising customer ID. Do not send passwords, developer tokens, or private keys. We will verify your authority and delete the requested data unless a specific legal or security obligation requires retention. Agencies and clients may also contact each other about records held by the agency outside Betelgeze.",
            "Connection metadata and any enabled reporting data are retained only as needed for the authorized service, support, and applicable legal or security obligations. Disconnecting stops future access through that integration but does not by itself erase historical records or backups. Retained information remains protected and subject to this policy and applicable Google data-use restrictions.",
        ],
    },
    {
        title: "SMS and MMS Communications",
        body: [
            "Betelgeze enables agencies to send and receive SMS and MMS through Twilio using an agency-owned phone number. Messages may include a consent confirmation, a secure onboarding link, service or project updates, requested information, and direct replies within an active client conversation. The agency identified in the message is the sender, and Betelgeze provides the communication technology used to route and retain the conversation.",
            "SMS consent must be freely given for the identified sender and stated purpose. Providing a mobile number alone does not authorize unrelated promotional messages, consent is not transferred between agencies, and agencies using Betelgeze are responsible for obtaining and retaining any consent required for their messages.",
            "Message frequency varies according to the client's onboarding, project activity, and conversation with the agency. Message and data rates may apply. Recipients can reply STOP to opt out of SMS messages and may reply HELP for assistance. After an opt-out, no further SMS messages will be sent unless the recipient later gives valid consent again, apart from a permitted final confirmation that the opt-out was processed.",
            "We do not sell, rent, or share mobile phone numbers, SMS opt-in data, or messaging consent with third parties or affiliates for marketing or promotional purposes. Operational providers such as Twilio may process mobile information only as needed to transmit messages, provide delivery and compliance functions, secure the service, and support Betelgeze's operation; they do not receive that information from us for their own marketing.",
        ],
    },
    {
        title: "Service Providers",
        body: [
            "We use trusted service providers to operate our systems, including hosting, database, file storage, project management, analytics, and communication providers. These providers process information only as needed to support our services.",
            "Examples may include Vercel, Supabase, Cloudflare R2, Twilio, Meta WhatsApp Business Platform, and Google for connected Google Ads functionality. Google also handles information under its own privacy policy when you use its services.",
        ],
    },
    {
        title: "Data Retention",
        body: [
            "We keep client information for as long as needed to provide services, maintain project records, comply with legal obligations, resolve disputes, and support legitimate business operations.",
            "Messaging and consent records may be retained for as long as needed to document the communication, honour opt-out requests, meet legal or carrier requirements, and demonstrate when and how consent was obtained or withdrawn.",
            "Clients may request deletion of information where applicable, subject to records we must keep for legal, security, or business reasons.",
        ],
    },
    {
        title: "Security",
        body: [
            "We use technical and organizational safeguards including HTTPS, encrypted integration credentials, and access controls that scope client connections to the appropriate workspace and relationship. Google access tokens and service-account private keys are used on the backend and are not returned to client browsers. No online system is completely secure; access is limited to authorized people and providers for the purposes described in this policy.",
        ],
    },
    {
        title: "Client Choices",
        body: [
            "Clients can ask us to correct, update, export, or delete personal information where applicable. Clients can stop messaging through WhatsApp at any time and can reply STOP to an SMS to withdraw SMS consent.",
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
                    Betelgeze
                </Link>

                <h1 className="mt-6 text-3xl font-semibold tracking-tight sm:text-4xl">
                    Privacy Policy
                </h1>

                <p className="mt-3 text-sm text-slate-500">
                    Effective date: 7 September 2026
                </p>

                <p className="mt-6 leading-7 text-slate-700">
                    This Privacy Policy explains how Betelgeze collects, uses,
                    stores, shares, and deletes information when agencies and
                    their clients use our workspaces, onboarding, communications,
                    client portals, and connected services such as Google Ads.
                </p>

                <div className="mt-8 space-y-8">
                    {SECTIONS.map((section) => (
                        <section key={section.title} id={section.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}>
                            <h2 className="text-xl font-semibold text-slate-950">
                                {section.title}
                            </h2>

                            <div className="mt-3 space-y-3">
                                {section.body.map((paragraph, index) => (
                                    <p
                                        key={`${section.title}-${index}`}
                                        className="leading-7 text-slate-700"
                                    >
                                        {paragraph}
                                    </p>
                                ))}
                            </div>
                        </section>
                    ))}
                </div>

                <section id="contact" className="mt-8 border-t border-slate-200 pt-8">
                    <h2 className="text-xl font-semibold text-slate-950">
                        Contact
                    </h2>

                    <p className="mt-3 leading-7 text-slate-700">
                        For privacy questions, access requests, or deletion requests,
                        email <a href="mailto:support@betelgeze.com" className="font-medium text-[#1E3A5F] underline underline-offset-2">support@betelgeze.com</a> or
                        message our team through your active project communication channel.
                    </p>
                    <p className="mt-3 leading-7 text-slate-700">
                        Platform use, connected services, and SMS/MMS participation are also governed by the <Link href="/terms" className="font-medium text-[#1E3A5F] underline underline-offset-2">Betelgeze Terms and Conditions</Link>.
                    </p>
                </section>
            </article>
        </main>
    )
}
