import { IntegrationProvider } from "@/lib/workspace-integrations"

type Connection = { provider: IntegrationProvider; enabled: boolean; mode: string; config_hint: Record<string, string | null> }
type Props = { connections: Connection[]; action: (provider: IntegrationProvider, formData: FormData) => Promise<void> }

const fields: Record<IntegrationProvider, Array<[string, string, string]>> = {
    stripe: [["secret_key", "Stripe secret key", "sk_live_… or sk_test_…"], ["webhook_secret", "Webhook signing secret", "whsec_…"], ["default_currency", "Default currency", "usd"]],
    meta_whatsapp: [["access_token", "Meta access token", "Permanent access token"], ["phone_number_id", "WhatsApp phone number ID", "From Meta"], ["webhook_verify_token", "Webhook verification token", "Choose a long random value"], ["consent_template_name", "Consent template name", "Template name"], ["consent_template_language", "Template language", "en_US"]],
    clickup: [["api_token", "ClickUp API token", "pk_…"], ["workspace_id", "ClickUp workspace ID", "Numeric workspace ID"], ["clients_space_id", "Clients space ID", "Space ID"], ["client_folder_template_id", "Client folder template ID", "Template folder ID"]],
}
const titles: Record<IntegrationProvider, string> = { stripe: "Stripe", meta_whatsapp: "Meta WhatsApp", clickup: "ClickUp" }

export function WorkspaceConnections({ connections, action }: Props) {
    return <section className="mt-8"><h2 className="text-lg font-semibold">Connections</h2><p className="mt-1 text-sm text-neutral-400">Save this workspace’s Stripe, WhatsApp, and ClickUp credentials. Secrets are encrypted and never shown again.</p><div className="mt-4 grid gap-4 lg:grid-cols-3">{connections.map((connection) => <details key={connection.provider} className="rounded-2xl border border-neutral-800 bg-neutral-900 p-5"><summary className="flex cursor-pointer list-none items-center justify-between gap-3"><div><p className="font-medium">{titles[connection.provider]}</p><p className={`mt-1 text-sm ${connection.enabled ? "text-emerald-300" : "text-neutral-500"}`}>{connection.mode === "platform_legacy" ? "Using ScaylUp platform connection" : connection.enabled ? "Credentials saved" : "Not connected"}</p></div><span className="text-sm text-neutral-400">Edit</span></summary><form action={action.bind(null, connection.provider)} className="mt-5 space-y-3">{fields[connection.provider].map(([name, label, placeholder]) => <label key={name} className="block text-sm text-neutral-300">{label}<input name={name} type={name.includes("token") || name.includes("secret") || name === "api_token" ? "password" : "text"} placeholder={placeholder} className="mt-1.5 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-white" /></label>)}<button className="w-full rounded-lg bg-white px-3 py-2 text-sm font-medium text-black">Save {titles[connection.provider]} connection</button></form></details>)}</div></section>
}
