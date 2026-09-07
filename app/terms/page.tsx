import Link from "next/link"
import type { Metadata } from "next"

export const metadata: Metadata = {
    title: "Terms and Conditions | Betelgeze",
    description: "Terms for Betelgeze platform use, Google Ads connections, client reporting, and SMS/MMS communications.",
    alternates: { canonical: "https://www.betelgeze.com/terms" },
}

type TermsSection = {
    title: string
    body: string[]
    emphasis?: string[]
}

const SECTIONS: TermsSection[] = [
    {
        title: "Platform Use and Agency Services",
        body: [
            "These terms apply to use of Betelgeze's agency workspaces, onboarding, client portals, connected services, and client messaging. By using these features, you agree to these terms. If you act for a business or agency, you must be authorized to do so.",
            "Betelgeze provides the software platform. The agency identified in your onboarding, workspace, or communications supplies the professional services you purchase. Your agreement with that agency governs its fees, deliverables, advertising strategy, and service commitments. Connecting an account through Betelgeze does not itself establish a new advertising budget or authorize additional charges.",
        ],
    },
    {
        title: "Workspace Access and Responsibilities",
        body: [
            "Use only accounts, workspaces, client links, and data you are authorized to access. Keep login credentials, private keys, and client access links confidential. Workspace owners are responsible for their team membership, connected provider credentials, and the permissions granted to their agency.",
            "Agencies must give clients accurate information about the services and data access they request and obtain the permissions and consents needed to process client data. Notify your agency or Betelgeze support if access is no longer authorized or you suspect misuse. You must not access another client's information or use the platform to bypass a provider's approval, access, or quota restrictions.",
        ],
    },
    {
        title: "Google Ads Connections and Authorization",
        body: [
            "A workspace owner may configure the agency's Google Ads manager connection. A client who submits an advertising customer ID and confirms authorization instructs Betelgeze to check existing agency access and, where available, send a manager-link invitation for that account. You must have authority to request this connection on behalf of the advertiser.",
            "An authorized user must approve a new manager link inside Google Ads. The approval grants the agency manager access according to Google's permissions and the settings shown by Google. It should not be treated as a report-only permission: a manager link may allow the agency to manage advertising in Google Ads. Betelgeze does not approve the invitation on your behalf.",
            "The current Betelgeze Google Ads integration performs account linking and access verification. Performance reporting is being developed and will be available only when enabled. The current integration does not create campaigns, change ads or budgets, or upload remarketing audiences. Any campaign management your agency performs directly in Google Ads is governed by your authorization to that agency and Google's terms.",
            "Google Ads data may be used only for the authorized connection, service, and reporting purposes described in the Privacy Policy, consistent with applicable Google terms and policies. Workspace users must not sell it, disclose it to unrelated clients, or use it for unrelated profiling or general-purpose AI training.",
        ],
    },
    {
        title: "Google Approval, Availability, and Reports",
        body: [
            "Google controls developer-token approvals, service-account permissions, account eligibility, quotas, and API availability. A successful manager connection check does not guarantee permission for every API operation. Account linking or reporting may remain unavailable while Google reviews access or when permissions, quotas, or account status prevent a request. Betelgeze cannot guarantee an approval date or override Google's requirements.",
            "When reporting is available, it will reflect data retrieved from Google for the connected account and selected dates. Reporting may be delayed or revised by Google and may vary with currency, time zone, attribution settings, and refresh time. Reports do not guarantee advertising outcomes. Google advertising charges remain subject to the advertiser's arrangements with Google and the agency.",
        ],
    },
    {
        title: "Disconnecting Services and Ending Access",
        body: [
            "A workspace owner can disable the Google Ads integration in Settings > Connections. This removes the stored integration credentials used by Betelgeze but does not remove the manager link inside Google Ads, pause advertising, cancel your agreement with the agency, or delete records held by Google.",
            "To withdraw agency manager access, remove the manager link in Google Ads > Admin > Access and security > Managers, subject to Google's requirements. Contact your agency if you need help. Requests to delete information stored by Betelgeze are handled through the Privacy Policy; disconnection and data deletion are separate actions.",
            "Access to a connected feature may be restricted or suspended if authorization is withdrawn, a provider disables access, or use threatens security or violates these terms. Any continued retention of records is governed by the Privacy Policy and applicable legal requirements.",
        ],
    },
    {
        title: "Program Description",
        body: [
            "Betelgeze Client Messaging enables agencies using Betelgeze to send and receive transactional and service-related SMS and MMS with clients who have consented to communicate by text. Messages may include consent confirmations, secure onboarding links, account or project updates, requested information, service notifications, and direct replies within an active client conversation.",
            "The agency identified in each message is the sender. Betelgeze provides the communication platform used to route, deliver, and retain the conversation. This program is not used for third-party lead generation, affiliate marketing, or unrelated promotional messages.",
        ],
    },
    {
        title: "Consent and Enrollment",
        body: [
            "Recipients must give prior express consent directly to the identified agency for the stated messaging purpose. Providing a mobile number by itself does not constitute consent, SMS consent is not a condition of purchasing goods or services, and consent cannot be bought, sold, transferred, or applied to another agency or messaging program.",
            "Agencies using Betelgeze are responsible for collecting and retaining legally sufficient proof of consent. A recipient who initiates an SMS conversation may receive responses related to that conversation, but this does not authorize unrelated or indefinite recurring messages.",
        ],
    },
    {
        title: "Message Frequency and Charges",
        body: [
            "Message frequency varies according to the recipient's onboarding, project activity, service updates, and conversation with the agency. Message and data rates may apply according to the recipient's mobile plan. Betelgeze and the sending agency do not charge a separate fee merely for receiving SMS or MMS through this program.",
        ],
    },
    {
        title: "Help and Opt-Out",
        body: [
            "For assistance, reply HELP to the number that sent the message. Recipients may also contact the agency identified in the message through the support or project contact details it provided during onboarding, or email Betelgeze support at support@betelgeze.com.",
            "To stop receiving SMS or MMS from the program, reply STOP at any time. A final confirmation may be sent to acknowledge the opt-out; no further messages will be sent unless the recipient later provides valid consent again. Other standard opt-out keywords, including STOPALL, UNSUBSCRIBE, CANCEL, END, QUIT, and REVOKE, may also be recognized by the messaging provider.",
        ],
        emphasis: ["HELP", "STOP"],
    },
    {
        title: "Delivery and Carrier Disclaimer",
        body: [
            "Message delivery is subject to network availability, carrier filtering, device settings, and other factors outside Betelgeze's or the sending agency's control. Carriers are not liable for any delayed or undelivered messages.",
        ],
    },
    {
        title: "Acceptable Use",
        body: [
            "Recipients may not use the messaging program for unlawful, abusive, fraudulent, infringing, or harmful content. Agencies must comply with applicable law, carrier requirements, Twilio's messaging policies, and Betelgeze platform rules when sending messages.",
        ],
    },
    {
        title: "Privacy",
        body: [
            "Mobile information and messaging consent are handled as described in the Betelgeze Privacy Policy. Mobile phone numbers and SMS opt-in data are not sold, rented, or shared with third parties or affiliates for their marketing or promotional purposes.",
        ],
    },
    {
        title: "Changes to These Terms",
        body: [
            "We may update these Terms and Conditions to reflect changes to the platform, connected services, law, or carrier requirements. The current version will remain publicly available on this page with its effective date. Material changes to the use of Google data will be disclosed and any required additional consent obtained before the new use begins.",
        ],
    },
]

function emphasizedText(value: string, terms: string[] = []) {
    if (!terms.length) return value
    const pattern = new RegExp(`\\b(${terms.join("|")})\\b`, "g")
    return value.split(pattern).map((part, index) => terms.includes(part)
        ? <strong key={`${part}:${index}`} className="font-bold text-slate-950">{part}</strong>
        : part)
}

export default function TermsPage() {
    return (
        <main className="min-h-screen bg-[#F8F7F3] px-5 py-8 text-slate-900 sm:px-6 sm:py-12">
            <article className="mx-auto max-w-3xl rounded-lg border border-slate-200 bg-white p-6 shadow-sm sm:p-10">
                <Link href="/" className="text-sm font-medium text-[#1E3A5F] hover:underline">
                    Betelgeze
                </Link>

                <h1 className="mt-6 text-3xl font-semibold tracking-tight sm:text-4xl">
                    Terms and Conditions
                </h1>

                <p className="mt-3 text-sm text-slate-500">
                    Effective date: 7 September 2026
                </p>

                <p className="mt-6 leading-7 text-slate-700">
                    These Terms and Conditions govern use of the Betelgeze
                    platform, including agency and client access, Google Ads
                    connections, reporting when available, and the Betelgeze
                    Client Messaging SMS and MMS program.
                </p>

                <div className="mt-8 space-y-8">
                    {SECTIONS.map((section) => (
                        <section key={section.title} id={section.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}>
                            <h2 className="text-xl font-semibold text-slate-950">
                                {section.title}
                            </h2>
                            <div className="mt-3 space-y-3">
                                {section.body.map((paragraph) => (
                                    <p key={paragraph} className="leading-7 text-slate-700">
                                        {emphasizedText(paragraph, section.emphasis)}
                                    </p>
                                ))}
                            </div>
                        </section>
                    ))}
                </div>

                <section className="mt-8 border-t border-slate-200 pt-8">
                    <h2 className="text-xl font-semibold text-slate-950">Contact</h2>
                    <p className="mt-3 leading-7 text-slate-700">
                        For platform, Google Ads connection, or data-access questions, email <a href="mailto:support@betelgeze.com" className="font-medium text-[#1E3A5F] underline underline-offset-2">support@betelgeze.com</a>.
                    </p>
                    <p className="mt-3 leading-7 text-slate-700">
                        For messaging support, reply <strong>HELP</strong> to the
                        number that sent the message or contact the agency named
                        in the message using its supplied project contact details.
                    </p>
                    <p className="mt-3 leading-7 text-slate-700">
                        See the <Link href="/privacy" className="font-medium text-[#1E3A5F] underline underline-offset-2">Betelgeze Privacy Policy</Link> for information about how personal and mobile information is handled.
                    </p>
                </section>
            </article>
        </main>
    )
}
