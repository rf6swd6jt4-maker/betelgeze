import Link from "@/components/workspace/WorkspaceLink"
import { DetailPageHeader, SectionHeading } from "@/components/detail"
import { Table, TableBody, TableCell, TableEmpty, TableHead, TableHeading, TableRow } from "@/components/list/Table"
import { Status } from "@/components/ui"
import { WorkspaceTopBar } from "@/components/workspace/WorkspaceTopBar"
import { AddSmsNumbers, SignalHouseAccountActions, SignalHouseConnectForm } from "@/components/signalhouse/SignalHouseControls"
import { requireCampaigns } from "@/lib/campaigns/server"
import { loadSignalHouse, loadSmsNumberUse } from "@/lib/signalhouse/server"
import { formatSmsNumber, registrationStatusLabels, smsNumberCanSend } from "@/lib/signalhouse/model"
import { formatRelativeTime } from "@/lib/ui/relative-time"

export const dynamic = "force-dynamic"

const propertyRow = "grid min-h-9 grid-cols-[7rem_minmax(0,1fr)] items-baseline gap-2 py-1.5 text-sm"
const sevenDay = (health: Record<string, unknown>) => (health.sevenDay && typeof health.sevenDay === "object" ? health.sevenDay : {}) as Record<string, number | null | undefined>

/** Settings, Connections, SignalHouse (docs/signalhouse.md): the account, its 10DLC registrations and its numbers. */
export default async function SignalHousePage({ params }: { params: Promise<{ workspaceSlug: string }> }) {
    const { workspaceSlug } = await params
    const { workspace, user } = await requireCampaigns(workspaceSlug)
    const [loaded, use] = await Promise.all([loadSignalHouse(workspace.id), loadSmsNumberUse(workspace.id)])
    const account = loaded.accounts[0] ?? null
    const statusOf = new Map(loaded.registrations.map(registration => [`${registration.account_id}:${registration.external_id}`, registration.status]))
    const added = loaded.numbers.filter(number => number.added_at && !number.removed_at)
    const available = loaded.numbers.filter(number => (!number.added_at || number.removed_at) && number.status !== "RELEASED")
    const usedBy = (id: string) => [
        ...use.campaigns.filter(item => item.sms_number_id === id).map(item => item.name),
        ...use.sources.filter(item => item.sms_number_id === id).map(item => item.name),
    ]
    const registrationName = (accountId: string, id: string | null) => {
        const registration = loaded.registrations.find(item => item.account_id === accountId && item.external_id === id)
        return registration ? `${registration.usecase ? registration.usecase.replace(/_/g, " ").toLowerCase().replace(/^\w/, letter => letter.toUpperCase()) : "10DLC"} · ${registration.external_id}` : id ?? "No registration"
    }

    return <main className="min-h-screen bg-neutral-950 px-4 pb-10 text-white sm:px-6">
        <WorkspaceTopBar userId={user.id} workspace={workspace} currentProduct="client-work" />
        <div className="mx-auto max-w-5xl pt-5">
            <DetailPageHeader category="Connection" reference={account?.group_id ?? "SignalHouse"} title="SignalHouse"
                subtitle={account ? `${account.name || account.group_id} · texts your campaigns' leads and receives their replies` : "Texts your campaigns' leads from A2P-registered numbers"}
                labels={account ? <Status label={account.status === "connected" ? "Connected" : "Needs attention"} tone={account.status === "connected" ? "green" : "yellow"} /> : <Status label="Not connected" tone="grey" />}
                facts={account ? [{ label: added.length === 1 ? "number" : "numbers", value: added.length }] : []}
                updated={account?.last_synced_at ? formatRelativeTime(account.last_synced_at) : "never"} />

            {!account ? <section className="pt-6">
                <SectionHeading>Connect</SectionHeading>
                <SignalHouseConnectForm workspaceSlug={workspace.slug} />
            </section> : <div className="flex flex-col gap-8 pt-5">
                <section aria-label="Account">
                    <SectionHeading action={<SignalHouseAccountActions workspaceSlug={workspace.slug} accountId={account.id} />}>Account</SectionHeading>
                    {account.last_error ? <p role="alert" className="mb-2 text-sm text-amber-200">{account.last_error}</p> : null}
                    <div className={propertyRow}><span className="text-neutral-500">Group</span><span className="text-neutral-200">{account.name ? `${account.name} · ` : ""}<span className="font-mono text-xs">{account.group_id}</span></span></div>
                    <div className={propertyRow}><span className="text-neutral-500">API key</span><span className="text-neutral-200">Ending <span className="font-mono text-xs">{account.key_hint}</span>{account.key_expires_at ? <span className="text-neutral-500"> · expires {new Date(account.key_expires_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span> : null}</span></div>
                    <div className={propertyRow}><span className="text-neutral-500">Webhook</span><span className="text-neutral-200">{account.webhook_id ? <Status label={account.last_webhook_at ? `Last event ${formatRelativeTime(account.last_webhook_at)} ago` : "Set up, no events yet"} tone="green" /> : <Status label="Not set up" tone="yellow" />}</span></div>
                    <div className={propertyRow}><span className="text-neutral-500">Read</span><span className="text-neutral-200">{account.last_synced_at ? `${formatRelativeTime(account.last_synced_at)} ago` : "Not yet"}</span></div>
                </section>

                <section aria-label="10DLC registrations">
                    <SectionHeading count={loaded.registrations.length}>10DLC registrations</SectionHeading>
                    <p className="mb-2 max-w-3xl text-xs leading-5 text-neutral-500">Carriers only deliver texts from numbers on an active registration. SignalHouse calls these campaigns; they are separate from your campaigns here, and are made and approved in SignalHouse.</p>
                    <Table ariaLabel="10DLC registrations" className="max-sm:[&_thead]:hidden">
                        <TableHead><TableHeading>Registration</TableHeading><TableHeading className="max-sm:hidden">Use case</TableHeading><TableHeading numeric className="max-sm:hidden">Numbers</TableHeading><TableHeading>Status</TableHeading></TableHead>
                        <TableBody>{loaded.registrations.length ? loaded.registrations.map(registration => <TableRow key={registration.id}>
                            <TableCell primary className="w-full max-w-0 sm:w-[40%]"><span className="block truncate font-mono text-xs">{registration.external_id}</span>{registration.description ? <span className="block truncate text-xs font-normal text-neutral-500">{registration.description}</span> : null}</TableCell>
                            <TableCell className="max-sm:hidden">{registration.usecase.replace(/_/g, " ").toLowerCase().replace(/^\w/, letter => letter.toUpperCase()) || "–"}</TableCell>
                            <TableCell numeric className="max-sm:hidden">{loaded.numbers.filter(number => number.registration_external_id === registration.external_id).length}</TableCell>
                            <TableCell><Status label={registrationStatusLabels[registration.status] ?? (registration.status || "Unknown")} tone={registration.status === "ACTIVE" ? "green" : registration.status === "REJECTED" || registration.status === "EXPIRED" ? "red" : "yellow"} /></TableCell>
                        </TableRow>) : <TableEmpty columns={4}>No 10DLC registrations in this group yet.</TableEmpty>}</TableBody>
                    </Table>
                </section>

                <section aria-label="Numbers">
                    <SectionHeading count={added.length} action={<AddSmsNumbers workspaceSlug={workspace.slug} available={available.map(number => ({ id: number.id, phone: formatSmsNumber(number.phone_e164), registration: registrationName(number.account_id, number.registration_external_id), ready: smsNumberCanSend(number, statusOf.get(`${number.account_id}:${number.registration_external_id}`)) }))} />}>Numbers</SectionHeading>
                    <p className="mb-2 max-w-3xl text-xs leading-5 text-neutral-500">Pick a campaign&apos;s number on its Text flows tab, or give a source its own on the source&apos;s page.</p>
                    <Table ariaLabel="Numbers" className="max-sm:[&_thead]:hidden max-sm:[&_tbody]:border-t max-sm:[&_tbody]:border-card-border">
                        <TableHead><TableHeading>Number</TableHeading><TableHeading className="max-md:hidden">Used by</TableHeading><TableHeading numeric className="max-sm:hidden">Sent, 7 days</TableHeading><TableHeading numeric className="max-md:hidden">Delivered</TableHeading><TableHeading numeric className="max-md:hidden">Opt-outs</TableHeading><TableHeading>Status</TableHeading></TableHead>
                        <TableBody>{added.length ? added.map(number => {
                            const health = sevenDay(number.health)
                            const ready = smsNumberCanSend(number, statusOf.get(`${number.account_id}:${number.registration_external_id}`))
                            const users = usedBy(number.id)
                            return <TableRow key={number.id}>
                                <TableCell primary className="w-full max-w-0 max-sm:h-14 sm:w-[30%]">
                                    <span className="flex min-w-0 flex-col"><Link data-table-open href={`/${workspace.slug}/settings/signalhouse/numbers/${number.id}`} prefetch={false} className="min-w-0 truncate text-sm tabular-nums hover:underline sm:text-[13px]">{formatSmsNumber(number.phone_e164)}</Link>
                                        <span className="min-w-0 truncate text-xs font-normal text-neutral-500">{number.label || registrationName(number.account_id, number.registration_external_id)}</span></span>
                                </TableCell>
                                <TableCell className="max-md:hidden">{users.length ? <span className="block max-w-56 truncate">{users.join(", ")}</span> : <span className="text-neutral-600">Not used</span>}</TableCell>
                                <TableCell numeric className="max-sm:hidden">{typeof health.messagesSent === "number" ? health.messagesSent.toLocaleString("en-US") : "–"}</TableCell>
                                <TableCell numeric className="max-md:hidden">{typeof health.deliveryRate === "number" ? `${health.deliveryRate}%` : "–"}</TableCell>
                                <TableCell numeric className="max-md:hidden">{typeof health.optOuts === "number" ? health.optOuts : "–"}</TableCell>
                                <TableCell>{ready ? <Status label="Ready" tone="green" /> : <Status label={number.status === "RELEASED" ? "Released" : "Waiting on registration"} tone={number.status === "RELEASED" ? "red" : "yellow"} />}</TableCell>
                            </TableRow>
                        }) : <TableEmpty columns={6}>{available.length ? "No numbers added yet. Add the ones your campaigns should text from." : "No numbers in this group yet. Buy one in SignalHouse, attach it to a 10DLC registration, then read again."}</TableEmpty>}</TableBody>
                    </Table>
                </section>

                <section aria-label="Rules for every number">
                    <SectionHeading>Rules for every number</SectionHeading>
                    <ul className="flex max-w-3xl list-disc flex-col gap-1.5 pl-5 text-sm text-neutral-300 marker:text-neutral-600">
                        <li>SignalHouse handles STOP and HELP and stops texts to anyone who has opted out.</li>
                        <li>A lead keeps the number that first texted them, so their replies stay in one conversation.</li>
                        <li>A reply is matched to its lead by phone number. If one person is a lead in two campaigns on the same number, it goes to the one texted most recently.</li>
                        <li>A number only sends while its 10DLC registration is active.</li>
                    </ul>
                </section>
            </div>}
        </div>
    </main>
}
