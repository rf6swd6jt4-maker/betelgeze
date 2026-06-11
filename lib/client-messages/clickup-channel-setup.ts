import { supabaseAdmin } from "@/lib/supabase/admin"
import { normalizeMessageAddress } from "@/lib/client-messages/addresses"
import { MODULES } from "@/lib/onboarding/modules"
import {
    FormResponse,
    FormResponseValue,
    getOnboardingForm,
    StoredUpload,
} from "@/lib/onboarding/forms"
import {
    AuthorizedClickUpWorkspace,
    createClickUpChatChannel,
    createClickUpFolderFromTemplate,
    createClickUpLocationChatChannel,
    createClickUpTask,
    createClickUpTaskAttachment,
    deleteClickUpChatChannel,
    deleteClickUpFolder,
    deleteClickUpSpace,
    getClickUpClientFolderTemplateId,
    getClickUpClientsSpaceId,
    getClickUpWorkspaceMemberIds,
    getClickUpWorkspaceId,
    getAuthorizedClickUpWorkspaces,
    hasClickUpConfig,
    retrieveClickUpFolderLists,
    updateClickUpTask,
} from "@/lib/client-messages/clickup"
import { downloadOnboardingUpload } from "@/lib/onboarding/uploads"

function getChannelId(response: unknown): string | null {
    if (!response || typeof response !== "object") return null

    const value = response as {
        id?: string
        data?: { id?: string }
        channel?: { id?: string }
    }

    return value.id ?? value.data?.id ?? value.channel?.id ?? null
}

function getEntityId(response: unknown): string | null {
    if (!response || typeof response !== "object") return null

    const value = response as {
        id?: string | number
        data?: { id?: string | number }
        space?: { id?: string | number }
        folder?: { id?: string | number }
        list?: { id?: string | number }
    }
    const id =
        value.id ??
        value.data?.id ??
        value.space?.id ??
        value.folder?.id ??
        value.list?.id

    return id ? String(id) : null
}

function getErrorMessage(error: unknown) {
    return error instanceof Error ? error.message : "Unknown ClickUp error"
}

const CLIENT_FOLDER_COLOR = "#e50000"

const ONBOARDING_INFORMATION_LIST_NAME = "Onboarding Information"
const CLIENT_WORK_LIST_NAME = "Client Work"

async function addActivity(
    clientId: string,
    activityType: string,
    activityText: string
) {
    await supabaseAdmin.from("client_activity").insert({
        client_id: clientId,
        activity_type: activityType,
        activity_text: activityText,
    })
}

function normalizeClickUpName(value: string) {
    return value
        .trim()
        .replace(/^\d+\s*[-.)]?\s*/u, "")
        .replace(/\s+/g, " ")
        .toLowerCase()
}

function getListIdByName(response: unknown, name: string) {
    const payload = response as {
        lists?: unknown
        data?: {
            lists?: unknown
        }
    } | null
    const lists = Array.isArray(payload?.lists)
        ? payload.lists
        : Array.isArray(payload?.data?.lists)
          ? payload.data.lists
          : []
    const normalizedName = normalizeClickUpName(name)

    for (const list of lists) {
        if (!list || typeof list !== "object" || Array.isArray(list)) {
            continue
        }

        const value = list as {
            id?: string | number
            name?: string
        }

        if (
            value.name &&
            normalizeClickUpName(value.name) === normalizedName
        ) {
            return value.id ? String(value.id) : null
        }
    }

    return null
}

function wait(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms))
}

async function getTemplateListIds(folderId: string) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
        const folderLists = await retrieveClickUpFolderLists({
            folderId,
        })
        const onboardingInformationListId = getListIdByName(
            folderLists,
            ONBOARDING_INFORMATION_LIST_NAME
        )
        const clientWorkListId = getListIdByName(
            folderLists,
            CLIENT_WORK_LIST_NAME
        )

        if (onboardingInformationListId && clientWorkListId) {
            return {
                onboardingInformationListId,
                clientWorkListId,
            }
        }

        await wait(1000)
    }

    return {
        onboardingInformationListId: null,
        clientWorkListId: null,
    }
}

async function saveClickUpItem({
    clientId,
    itemKey,
    itemType,
    clickupId,
    clickupParentId,
    stepKey,
}: {
    clientId: string
    itemKey: string
    itemType: string
    clickupId: string
    clickupParentId?: string | null
    stepKey?: string | null
}) {
    await supabaseAdmin.from("client_clickup_items").upsert(
        {
            client_id: clientId,
            item_key: itemKey,
            item_type: itemType,
            clickup_id: clickupId,
            clickup_parent_id: clickupParentId ?? null,
            step_key: stepKey ?? null,
            updated_at: new Date().toISOString(),
        },
        {
            onConflict: "client_id,item_key",
        }
    )
}

async function getClickUpItem(clientId: string, itemKey: string) {
    const { data } = await supabaseAdmin
        .from("client_clickup_items")
        .select("clickup_id")
        .eq("client_id", clientId)
        .eq("item_key", itemKey)
        .maybeSingle()

    return data?.clickup_id ?? null
}

function getTaskId(response: unknown) {
    return getEntityId(response)
}

async function getClientOnboardingSteps(clientId: string) {
    const { data: clientModules } = await supabaseAdmin
        .from("client_modules")
        .select("module_key")
        .eq("client_id", clientId)

    return (
        clientModules?.flatMap((row) => {
            const moduleDefinition = MODULES[row.module_key]

            if (!moduleDefinition) return []

            return moduleDefinition.steps.map((step) => ({
                ...step,
                moduleTitle: moduleDefinition.title,
            }))
        }) ?? []
    )
}

function formatUpload(upload: StoredUpload) {
    return [
        `- ${upload.name}`,
        `  - Type: ${upload.type}`,
        `  - Size: ${upload.size} bytes`,
        `  - Storage path: ${upload.path}`,
    ].join("\n")
}

function formatResponseValue(value: FormResponseValue) {
    if (typeof value === "string") {
        return value.trim() || "_Blank_"
    }

    if (Array.isArray(value)) {
        return value.length > 0
            ? value.map(formatUpload).join("\n")
            : "_No files uploaded_"
    }

    return "_Blank_"
}

function formatStepResponse({
    clientName,
    stepTitle,
    formKey,
    response,
}: {
    clientName: string
    stepTitle: string
    formKey?: string | null
    response?: FormResponse | null
}) {
    const form = getOnboardingForm(formKey ?? undefined)
    const lines = [
        `# ${stepTitle}`,
        "",
        `Client: ${clientName}`,
        `Submitted via onboarding portal: ${new Date().toISOString()}`,
    ]

    if (!form || !response) {
        return [
            ...lines,
            "",
            "This step has been marked complete in the onboarding portal.",
        ].join("\n")
    }

    for (const field of form.fields) {
        lines.push("", `## ${field.label}`)
        lines.push(formatResponseValue(response[field.name] ?? ""))
    }

    return lines.join("\n")
}

function getUploadsFromResponse(response?: FormResponse | null) {
    if (!response) return []

    return Object.values(response).flatMap((value) =>
        Array.isArray(value) ? (value as StoredUpload[]) : []
    )
}

async function attachUploadsToClickUpTask({
    clientId,
    stepKey,
    taskId,
    uploads,
}: {
    clientId: string
    stepKey: string
    taskId: string
    uploads: StoredUpload[]
}) {
    for (const upload of uploads) {
        const itemKey = `attachment:${stepKey}:${upload.path}`
        const existingAttachment = await getClickUpItem(clientId, itemKey)

        if (existingAttachment) continue

        try {
            const downloaded = await downloadOnboardingUpload(upload.path)
            const attachment = await createClickUpTaskAttachment({
                taskId,
                fileName: upload.name,
                contentType: downloaded.contentType || upload.type,
                bytes: downloaded.bytes,
            })
            const attachmentId = getEntityId(attachment) ?? upload.path

            await saveClickUpItem({
                clientId,
                itemKey,
                itemType: "attachment",
                clickupId: attachmentId,
                clickupParentId: taskId,
                stepKey,
            })
        } catch (error) {
            await addActivity(
                clientId,
                "clickup_attachment_failed",
                error instanceof Error
                    ? `ClickUp attachment failed for ${upload.name}: ${error.message}`
                    : `ClickUp attachment failed for ${upload.name}`
            )
        }
    }
}

export async function syncClientOnboardingStepToClickUp({
    clientId,
    stepKey,
}: {
    clientId: string
    stepKey: string
}) {
    if (!process.env.CLICKUP_API_TOKEN) return

    try {
        const [stepTaskId, onboardingTaskId, { data: client }, { data: response }] =
            await Promise.all([
                getClickUpItem(clientId, `step:${stepKey}`),
                getClickUpItem(clientId, "task:onboarding"),
                supabaseAdmin
                    .from("clients")
                    .select("name")
                    .eq("id", clientId)
                    .single(),
                supabaseAdmin
                    .from("client_form_responses")
                    .select("response")
                    .eq("client_id", clientId)
                    .eq("step_key", stepKey)
                    .maybeSingle(),
            ])

        if (!stepTaskId && !onboardingTaskId) return

        const step = (await getClientOnboardingSteps(clientId)).find(
            (candidate) => candidate.key === stepKey
        )

        const responseValue =
            response?.response && typeof response.response === "object"
                ? (response.response as FormResponse)
                : null

        await Promise.all([
            stepTaskId
                ? updateClickUpTask({
                      taskId: stepTaskId,
                      status: "Submitted",
                      markdownDescription: formatStepResponse({
                          clientName: client?.name ?? "Client",
                          stepTitle: step?.title ?? stepKey,
                          formKey: step?.formKey,
                          response: responseValue,
                      }),
                  })
                : Promise.resolve(),
            onboardingTaskId
                ? updateClickUpTask({
                      taskId: onboardingTaskId,
                      status: "In progress",
                  })
                : Promise.resolve(),
        ])

        if (stepTaskId) {
            await attachUploadsToClickUpTask({
                clientId,
                stepKey,
                taskId: stepTaskId,
                uploads: getUploadsFromResponse(responseValue),
            })
        }
    } catch (error) {
        await addActivity(
            clientId,
            "clickup_step_sync_failed",
            error instanceof Error
                ? `ClickUp onboarding step sync failed: ${error.message}`
                : "ClickUp onboarding step sync failed"
        )
    }
}

async function saveClientCommunicationChannel({
    clientId,
    externalAddress,
    clickupWorkspaceId,
    clickupSpaceId,
    clickupFolderId,
    clickupChannelId,
}: {
    clientId: string
    externalAddress: string
    clickupWorkspaceId: string
    clickupSpaceId: string
    clickupFolderId: string
    clickupChannelId: string
}) {
    const channelRecord = {
        client_id: clientId,
        provider: "meta_whatsapp",
        external_address: externalAddress,
        clickup_workspace_id: clickupWorkspaceId,
        clickup_space_id: clickupSpaceId,
        clickup_folder_id: clickupFolderId,
        clickup_channel_id: clickupChannelId,
        is_active: true,
        updated_at: new Date().toISOString(),
    }

    let { error } = await supabaseAdmin
        .from("client_communication_channels")
        .upsert(channelRecord, {
            onConflict: "client_id",
        })

    if (!error) return

    if (
        error.message.toLowerCase().includes("external_address") ||
        error.message.toLowerCase().includes("duplicate key")
    ) {
        await supabaseAdmin
            .from("client_communication_channels")
            .delete()
            .eq("provider", "meta_whatsapp")
            .eq("external_address", externalAddress)
            .neq("client_id", clientId)

        const retry = await supabaseAdmin
            .from("client_communication_channels")
            .upsert(channelRecord, {
                onConflict: "client_id",
            })

        error = retry.error
    }

    if (error?.message.toLowerCase().includes("clickup_space_id")) {
        const fallbackRecord: Omit<typeof channelRecord, "clickup_space_id"> =
            {
                client_id: channelRecord.client_id,
                provider: channelRecord.provider,
                external_address: channelRecord.external_address,
                clickup_workspace_id: channelRecord.clickup_workspace_id,
                clickup_folder_id: channelRecord.clickup_folder_id,
                clickup_channel_id: channelRecord.clickup_channel_id,
                is_active: channelRecord.is_active,
                updated_at: channelRecord.updated_at,
            }
        const retry = await supabaseAdmin
            .from("client_communication_channels")
            .upsert(fallbackRecord, {
                onConflict: "client_id",
            })

        error = retry.error
    }

    if (error?.message.toLowerCase().includes("clickup_folder_id")) {
        const fallbackRecord: Omit<typeof channelRecord, "clickup_folder_id"> =
            {
                client_id: channelRecord.client_id,
                provider: channelRecord.provider,
                external_address: channelRecord.external_address,
                clickup_workspace_id: channelRecord.clickup_workspace_id,
                clickup_space_id: channelRecord.clickup_space_id,
                clickup_channel_id: channelRecord.clickup_channel_id,
                is_active: channelRecord.is_active,
                updated_at: channelRecord.updated_at,
            }
        const retry = await supabaseAdmin
            .from("client_communication_channels")
            .upsert(fallbackRecord, {
                onConflict: "client_id",
            })

        error = retry.error
    }

    if (error) {
        throw new Error(`Could not save bridge record: ${error.message}`)
    }
}

export async function ensureClientClickUpChannel(clientId: string) {
    if (!hasClickUpConfig()) {
        await addActivity(
            clientId,
            "clickup_channel_skipped",
            "ClickUp Chat channel not created because ClickUp credentials are missing"
        )

        return {
            ok: false,
            error: "Missing CLICKUP_API_TOKEN, CLICKUP_WORKSPACE_ID, CLICKUP_CLIENTS_SPACE_ID, or CLICKUP_CLIENT_FOLDER_TEMPLATE_ID",
        }
    }

    const { data: client } = await supabaseAdmin
        .from("clients")
        .select("id, name, phone")
        .eq("id", clientId)
        .single()

    if (!client) {
        return {
            ok: false,
            error: "Client not found",
        }
    }

    const externalAddress = normalizeMessageAddress(client.phone ?? "")

    if (!externalAddress) {
        await addActivity(
            clientId,
            "clickup_channel_skipped",
            "ClickUp Chat channel not created because the client has no WhatsApp number"
        )

        return {
            ok: false,
            error: "Client has no WhatsApp number",
        }
    }

    try {
        const clientName = client.name?.trim() || "Client"
        const clientFolderName = clientName
        const clickupClientsSpaceId = getClickUpClientsSpaceId()
        const clickupFolder = await createClickUpFolderFromTemplate({
            spaceId: clickupClientsSpaceId,
            templateId: getClickUpClientFolderTemplateId(),
            name: clientFolderName,
            color: CLIENT_FOLDER_COLOR,
        })
        const clickupFolderId = getEntityId(clickupFolder)

        if (!clickupFolderId) {
            throw new Error("ClickUp did not return a Folder ID")
        }

        await saveClickUpItem({
            clientId: client.id,
            itemKey: "folder",
            itemType: "folder",
            clickupId: clickupFolderId,
            clickupParentId: clickupClientsSpaceId,
        })

        const { onboardingInformationListId, clientWorkListId } =
            await getTemplateListIds(clickupFolderId)

        if (!onboardingInformationListId || !clientWorkListId) {
            throw new Error(
                `ClickUp Folder template must include "${ONBOARDING_INFORMATION_LIST_NAME}" and "${CLIENT_WORK_LIST_NAME}" Lists`
            )
        }

        await Promise.all([
            saveClickUpItem({
                clientId: client.id,
                itemKey: "list:onboarding-information",
                itemType: "list",
                clickupId: onboardingInformationListId,
                clickupParentId: clickupFolderId,
            }),
            saveClickUpItem({
                clientId: client.id,
                itemKey: "list:client-work",
                itemType: "list",
                clickupId: clientWorkListId,
                clickupParentId: clickupFolderId,
            }),
        ])

        const onboardingTask = await createClickUpTask({
            listId: clientWorkListId,
            name: "Onboarding",
            status: "Not started",
            markdownDescription:
                "Tracks the overall onboarding lifecycle for this client.",
        })
        const onboardingTaskId = getTaskId(onboardingTask)

        if (!onboardingTaskId) {
            throw new Error("ClickUp did not return an Onboarding task ID")
        }

        await saveClickUpItem({
            clientId: client.id,
            itemKey: "task:onboarding",
            itemType: "task",
            clickupId: onboardingTaskId,
            clickupParentId: clientWorkListId,
        })

        const onboardingSteps = await getClientOnboardingSteps(client.id)

        await Promise.all(
            onboardingSteps.map(async (step) => {
                const clickupTask = await createClickUpTask({
                    listId: onboardingInformationListId,
                    name: step.title,
                    status: "Unsubmitted",
                    markdownDescription: [
                        `Module: ${step.moduleTitle}`,
                        "",
                        step.description,
                    ].join("\n"),
                })
                const clickupTaskId = getTaskId(clickupTask)

                if (!clickupTaskId) {
                    throw new Error(
                        `ClickUp did not return a task ID for ${step.title}`
                    )
                }

                await saveClickUpItem({
                    clientId: client.id,
                    itemKey: `step:${step.key}`,
                    itemType: "task",
                    clickupId: clickupTaskId,
                    clickupParentId: onboardingInformationListId,
                    stepKey: step.key,
                })
            })
        )

        const workspaceUserIds = await getClickUpWorkspaceMemberIds()
        let clickupChannelId: string | null = null
        let channelLocation = "folder"
        let folderChannelError: string | null = null

        try {
            const clickupChannel = await createClickUpLocationChatChannel({
                locationId: clickupFolderId,
                locationType: "folder",
                description: `Client communication channel for ${clientName}.`,
                topic: "Client fulfilment communication",
                userIds: workspaceUserIds,
                visibility: "PUBLIC",
            })

            clickupChannelId = getChannelId(clickupChannel)
        } catch (error) {
            folderChannelError = getErrorMessage(error)
        }

        if (!clickupChannelId) {
            const clickupChannel = await createClickUpChatChannel({
                name: clientFolderName,
                description: `Client communication channel for ${clientName}.`,
                topic: "Client fulfilment communication",
                userIds: workspaceUserIds,
                visibility: "PUBLIC",
            })

            clickupChannelId = getChannelId(clickupChannel)
            channelLocation = "standalone"
        }

        if (!clickupChannelId) {
            throw new Error(
                [
                    "ClickUp did not return a channel ID",
                    folderChannelError
                        ? `Folder channel error: ${folderChannelError}`
                        : null,
                ]
                    .filter(Boolean)
                    .join(". ")
            )
        }

        await saveClientCommunicationChannel({
            clientId: client.id,
            externalAddress,
            clickupWorkspaceId: getClickUpWorkspaceId(),
            clickupSpaceId: clickupClientsSpaceId,
            clickupFolderId,
            clickupChannelId,
        })

        await addActivity(
            client.id,
            "clickup_channel_created",
            `ClickUp client Folder and Chat channel created: ${clientFolderName}. Channel location: ${channelLocation}.`
        )

        return {
            ok: true,
            spaceId: clickupClientsSpaceId,
            folderId: clickupFolderId,
            channelId: clickupChannelId,
            channelLocation,
        }
    } catch (error) {
        const message = getErrorMessage(error)

        await addActivity(
            client.id,
            "clickup_channel_failed",
            `ClickUp Chat channel failed: ${message}`
        )

        return {
            ok: false,
            error: message,
        }
    }
}

export async function deleteClientClickUpResources(clientId: string) {
    if (!hasClickUpConfig()) {
        return {
            ok: false,
            error: "Missing CLICKUP_API_TOKEN, CLICKUP_WORKSPACE_ID, CLICKUP_CLIENTS_SPACE_ID, or CLICKUP_CLIENT_FOLDER_TEMPLATE_ID",
        }
    }

    const { data: channel } = await supabaseAdmin
        .from("client_communication_channels")
        .select("clickup_workspace_id, clickup_space_id, clickup_folder_id, clickup_channel_id")
        .eq("client_id", clientId)
        .eq("provider", "meta_whatsapp")
        .maybeSingle()

    if (!channel) {
        return {
            ok: true,
            deletedChannel: false,
            deletedFolder: false,
            deletedLegacySpace: false,
        }
    }

    try {
        const clickupClientsSpaceId = getClickUpClientsSpaceId()
        let deletedLegacySpace = false

        if (channel.clickup_folder_id) {
            await deleteClickUpFolder({
                folderId: channel.clickup_folder_id,
            })
        } else if (
            channel.clickup_space_id &&
            channel.clickup_space_id !== clickupClientsSpaceId
        ) {
            await deleteClickUpSpace({
                spaceId: channel.clickup_space_id,
            })
            deletedLegacySpace = true
        }

        if (channel.clickup_channel_id) {
            await deleteClickUpChatChannel({
                workspaceId: channel.clickup_workspace_id,
                channelId: channel.clickup_channel_id,
            })
        }

        return {
            ok: true,
            deletedChannel: Boolean(channel.clickup_channel_id),
            deletedFolder: Boolean(channel.clickup_folder_id),
            deletedLegacySpace,
        }
    } catch (error) {
        return {
            ok: false,
            error: getErrorMessage(error),
        }
    }
}

export async function checkClientClickUpConnection(clientId: string) {
    if (!process.env.CLICKUP_API_TOKEN) {
        await addActivity(
            clientId,
            "clickup_connection_failed",
            "ClickUp connection failed: CLICKUP_API_TOKEN is missing"
        )

        return
    }

    try {
        const configuredWorkspaceId = process.env.CLICKUP_WORKSPACE_ID
            ? getClickUpWorkspaceId()
            : "missing"
        const workspaces = await getAuthorizedClickUpWorkspaces()
        const workspaceSummary =
            workspaces.length > 0
                ? workspaces
                      .map(
                          (workspace: AuthorizedClickUpWorkspace) =>
                              `${workspace.name} (${workspace.id})`
                      )
                      .join(", ")
                : "No workspaces returned"
        const configuredWorkspace = workspaces.find(
            (workspace: AuthorizedClickUpWorkspace) =>
                workspace.id === configuredWorkspaceId
        )

        await addActivity(
            clientId,
            configuredWorkspace
                ? "clickup_connection_ok"
                : "clickup_connection_mismatch",
            configuredWorkspace
                ? `ClickUp connection ok. Configured workspace: ${configuredWorkspace.name} (${configuredWorkspace.id}).`
                : `ClickUp token can see: ${workspaceSummary}. Configured CLICKUP_WORKSPACE_ID: ${configuredWorkspaceId}.`
        )
    } catch (error) {
        await addActivity(
            clientId,
            "clickup_connection_failed",
            error instanceof Error
                ? `ClickUp connection failed: ${error.message}`
                : "ClickUp connection failed"
        )
    }
}
