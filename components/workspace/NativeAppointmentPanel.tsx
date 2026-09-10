"use client"

import Link from "@/components/workspace/WorkspaceLink"
import { List, ListItem, ListPrimaryRow, ListSecondaryRow, ListTitle, ListTrailing } from "@/components/list/List"
import { ListActionMenu } from "@/components/list/ListActionMenu"
import { MobileListActionSurface } from "@/components/list/MobileCardActionSurface"
import { AppointmentTable } from "@/components/appointment-setting/AppointmentTable"
import { DetailPageHeader } from "@/components/detail"
import { PanelTabHeader } from "@/components/panel/PanelTabHeader"
import { RelationshipStage, SquarePill, Status } from "@/components/ui"
import { appointmentSettingDetailHref } from "@/lib/appointment-setting"
import { formatRelativeTime, shortId } from "@/lib/ui/relative-time"
import type { NativeAppointmentSnapshot } from "@/lib/workspace-native-appointment"

function AppointmentList({ data }: { data: Extract<NativeAppointmentSnapshot, { kind: "appointment-setting" }> }) {
    const { relationships: eligibleRelationships, role } = data
    return <main className="min-h-full bg-neutral-950 px-4 pb-7 text-white sm:px-6">
        <div className="mx-auto max-w-7xl">
            <PanelTabHeader title="Appointment Setting" description="Retention relationships eligible to begin appointment setting." />

            <List ariaLabel="Relationships ready for appointment setting">
                {eligibleRelationships.length ? eligibleRelationships.map((relationship) => {
                    const relationshipTitle = relationship.business_name
                        ? `${relationship.primary_person_name} – ${relationship.business_name}`
                        : relationship.primary_person_name
                    const location = relationship.location
                    const phone = relationship.phone
                    const isTest = relationship.isTest
                    const relationshipHref = appointmentSettingDetailHref(data.workspaceSlug, relationship.id)
                    const actions = [{ label: "Open appointment table", href: relationshipHref }]
                    const rows = <>
                        <ListPrimaryRow>
                            <ListTitle href={relationshipHref} className="flex-1">{relationshipTitle}</ListTitle>
                            {isTest ? <SquarePill tone="yellow" className="shrink-0">Test</SquarePill> : null}
                            <RelationshipStage phase="retention" className="shrink-0" />
                            <Status label="Ready" tone="green" className="ml-auto shrink-0" />
                        </ListPrimaryRow>
                        <ListSecondaryRow>
                            {relationship.primary_contact_role ? <span className="hidden shrink-0 text-neutral-400 lg:inline">{relationship.primary_contact_role}</span> : null}
                            {phone ? <span className="hidden min-w-0 truncate text-neutral-200 sm:inline">{phone}</span> : null}
                            <span className="hidden min-w-0 truncate text-neutral-400 md:inline">{relationship.primary_email ?? "No email saved"}</span>
                            <span className="hidden min-w-0 truncate capitalize text-neutral-500 lg:inline">{location ?? "Location unset"}</span>
                            <ListTrailing>
                                <span className="font-mono text-neutral-500">{shortId(relationship.id)}</span>
                                <span className="whitespace-nowrap text-neutral-500">{formatRelativeTime(relationship.updated_at)}</span>
                                <ListActionMenu actions={actions} className="hidden sm:block" />
                            </ListTrailing>
                        </ListSecondaryRow>
                    </>
                    return <ListItem key={relationship.id} detailPreview={{
                        category: "Appointment Setting",
                        reference: shortId(relationship.id),
                        title: relationship.primary_person_name,
                        subtitle: relationship.business_name ?? "No company saved",
                        updated: formatRelativeTime(relationship.updated_at),
                    }}>
                        <MobileListActionSurface actions={actions} label={`Open actions for ${relationshipTitle}`}>{rows}</MobileListActionSurface>
                    </ListItem>
                }) : <div className="p-6">
                    <p className="text-lg font-semibold">No relationships ready for appointment setting.</p>
                    <p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-400">
                        Relationships appear here after fulfilment is complete and they enter Retention.
                        {role === "staff" ? null : <> <Link href={`/${data.workspaceSlug}/relationships?phase=retention`} className="text-neutral-200 underline decoration-neutral-600 underline-offset-4 hover:text-white">View Retention relationships</Link>.</>}
                    </p>
                </div>}
            </List>
        </div>
    </main>
}

function AppointmentDetail({ data }: { data: Extract<NativeAppointmentSnapshot, { kind: "appointment-detail" }> }) {
    const { relationship, latestUpdatedAt, serviceId, appointments, configuration, delivery } = data
    return <main className="min-h-full bg-neutral-950 px-4 py-6 text-white sm:px-6">
        <div className="mx-auto max-w-[92rem]">
            <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto]">
                <div className="min-w-0">
                    <DetailPageHeader
                        category="Appointment Setting"
                        reference={shortId(relationship.id)}
                        title={relationship.primary_person_name}
                        subtitle={relationship.business_name ?? "No company saved"}
                        labels={<>{relationship.isTest ? <SquarePill tone="yellow">Test</SquarePill> : null}<RelationshipStage phase="retention" /></>}
                        updated={formatRelativeTime(latestUpdatedAt)}
                    />

                    <AppointmentTable
                        key={relationship.id}
                        currentUserId={data.userId}
                        workspaceId={data.workspaceId}
                        workspaceSlug={data.workspaceSlug}
                        relationshipId={relationship.id}
                        serviceId={serviceId}
                        initialAppointments={appointments}
                        configuration={configuration}
                        initialDelivery={delivery}
                        initialNow={delivery.checkedAt}
                        draftCommandsEnabled={data.draftCommandsEnabled}
                    />
                </div>
                {data.context ? <aside data-native-context-spacer aria-hidden="true" className="hidden w-80 shrink-0 lg:block" /> : null}
            </div>
        </div>
    </main>
}

export default function NativeAppointmentPanel({ data }: { data: NativeAppointmentSnapshot }) {
    return data.kind === "appointment-setting" ? <AppointmentList data={data} /> : <AppointmentDetail data={data} />
}
