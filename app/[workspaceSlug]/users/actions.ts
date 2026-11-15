"use server"

import { revalidatePath } from "next/cache"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { normalizeWorkspaceRole, requireWorkspace } from "@/lib/workspaces"
import { emailDeliveryFailureDetails, sendSecurityNotice, sendWorkspaceInvitation } from "@/lib/email"
import { recordAdminActivity } from "@/lib/admin/activity"
import { createAccountToken, hashAccountToken } from "@/lib/auth/account-tokens"
import { accountFlowV2Enabled } from "@/lib/auth/account-flow"
import { authOrigin } from "@/lib/auth/origin"
import { workspaceRemovalBlockedMessage } from "@/lib/offboarding-blockers"
import { validOffboardInput, validReassignInput, type OffboardInput, type ReassignInput } from "@/lib/member-offboarding"

export type WorkspaceInvitationActionState = {
    ok: boolean
    message: string
}

function invitedRole(value: FormDataEntryValue | null) {
    const role = normalizeWorkspaceRole(value)
    if (role === "staff" || role === "admin") return role
    throw new Error("Invalid role")
}

function requestedServiceIds(formData: FormData) {
    return [...new Set(formData.getAll("serviceId").map(String).filter((value) => /^[0-9a-f-]{36}$/i.test(value)))]
}

async function requireUserManager(slug: string) {
    return requireWorkspace(slug, "admin")
}

export async function inviteWorkspaceUser(slug: string, formData: FormData): Promise<WorkspaceInvitationActionState> {
    if (!accountFlowV2Enabled()) return { ok: false, message: "New account invitations are paused until Account Flow V2 is enabled." }
    const { workspace, role, user } = await requireUserManager(slug)
    const email = String(formData.get("email") ?? "").trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 320) return { ok: false, message: "Enter a valid email address." }
    let requestedRole: "staff" | "admin"
    try {
        requestedRole = invitedRole(formData.get("role"))
    } catch {
        return { ok: false, message: "Choose a valid workspace role." }
    }
    if (role !== "owner" && requestedRole !== "staff") {
        return { ok: false, message: "Only workspace owners can invite admins." }
    }
    const serviceIds = requestedRole === "staff" ? requestedServiceIds(formData) : []

    const { data: targetState, error: targetStateError } = await supabaseAdmin.rpc("lookup_workspace_invitation_target", {
        p_workspace_id: workspace.id,
        p_actor_user_id: user.id,
        p_identifier: email,
    })
    if (targetStateError || !targetState) return { ok: false, message: "Betelgeze could not confirm that invitation target. Search for them again." }
    const currentTarget = targetState as { is_workspace_member?: unknown; invitation_pending?: unknown }
    if (currentTarget.is_workspace_member === true) return { ok: false, message: "That person is already in this workspace." }
    if (currentTarget.invitation_pending === true) return { ok: false, message: "An invitation for that person is already pending." }

    const proposedInvitationId = crypto.randomUUID()
    const invitationToken = createAccountToken()
    const invitationTokenHash = hashAccountToken(invitationToken)
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
    const inviteUrl = `${authOrigin()}/invitation?token=${encodeURIComponent(invitationToken)}`
    const { data: inviterProfile } = await supabaseAdmin
        .from("user_profiles")
        .select("display_name, username")
        .eq("user_id", user.id)
        .maybeSingle()
    const inviterName = inviterProfile?.display_name?.trim() || inviterProfile?.username || user.email || "A workspace administrator"
    const { data: persistedInvitation, error: persistError } = await supabaseAdmin.rpc("rotate_workspace_invitation", {
        p_invitation_id: proposedInvitationId,
        p_workspace_id: workspace.id,
        p_email: email,
        p_role: requestedRole,
        p_invited_by: user.id,
        p_expires_at: expiresAt,
        p_token_hash: invitationTokenHash,
        p_service_ids: serviceIds,
    })
    if (persistError || !persistedInvitation) return { ok: false, message: "Betelgeze could not safely save the invitation, so no email was sent." }
    const invitationId = (persistedInvitation as { invitation_id: string }).invitation_id

    try {
        const delivery = await sendWorkspaceInvitation({ to: email, workspaceName: workspace.name, inviterName, inviteUrl, invitationId })
        await supabaseAdmin.from("workspace_invitations").update({ delivery_status: "sent", provider_message_id: delivery.providerMessageId, sent_at: new Date().toISOString() }).eq("id", invitationId).eq("token_hash", invitationTokenHash)
    } catch (error) {
        const details = emailDeliveryFailureDetails(error)
        console.error("Workspace invitation email failed", {
            workspaceId: workspace.id,
            kind: details.kind,
            providerCode: details.providerCode,
            providerCommand: details.providerCommand,
            providerResponseCode: details.providerResponseCode,
            providerResponse: details.providerResponse,
        })
        await supabaseAdmin.from("workspace_invitations").update({ delivery_status: "failed", delivery_failed_at: new Date().toISOString(), delivery_failure_code: details.providerCode ?? details.kind }).eq("id", invitationId).eq("token_hash", invitationTokenHash)
        await recordAdminActivity({
            workspaceId: workspace.id,
            category: "integrations",
            level: "error",
            eventKey: "workspace.invitation.email.failed",
            summary: "Workspace invitation email failed",
            sourceHref: `/${slug}/settings#users`,
            actorUserId: user.id,
            actorKind: "staff",
            outcome: "failed",
            metricClassification: "external_call",
            diagnostics: {
                kind: details.kind,
                provider_code: details.providerCode,
                provider_command: details.providerCommand,
                provider_response_code: details.providerResponseCode,
                provider_response: details.providerResponse,
            },
        })
        const reason = details.kind === "authentication" || details.kind === "configuration"
            ? "Betelgeze's Resend connection is not configured correctly"
            : details.kind === "connection" || details.kind === "tls"
                ? "Betelgeze could not connect securely to Resend"
                : details.kind === "sender"
                    ? "Resend rejected Betelgeze's sender address"
                    : details.kind === "recipient"
                        ? "Resend rejected the recipient address"
                        : "Resend rejected the message"
        return { ok: false, message: `The invitation was saved, but its email failed because ${reason}. Resend it after the connection is fixed.` }
    }
    revalidatePath(`/${slug}/settings`)
    return { ok: true, message: "Invitation email sent." }
}

export type RemoveWorkspaceUserActionState = {
    ok: boolean
    message: string
}

// Offboarding guards in the database reject removal while the person still owns
// active client or shared-service work. Surface those reasons instead of letting
// the thrown error reach the generic page-load boundary.
function removalRefusalMessage(error: { message?: string }) {
    const text = error.message ?? ""
    if (/Client-team handover must be completed/i.test(text)) {
        return "This person is still the fulfilment manager or a service assignee on an active client team. Hand those clients over to someone else, then remove them."
    }
    if (/shared service assignments/i.test(text)) {
        return "This person is still in a shared service queue with active work. Remove them from those shared service assignments, then remove them from the workspace."
    }
    return null
}

export async function removeWorkspaceUser(slug: string, _previous: RemoveWorkspaceUserActionState | null, formData: FormData): Promise<RemoveWorkspaceUserActionState> {
    const { workspace, role: actingRole } = await requireUserManager(slug)
    const userId = String(formData.get("userId") ?? "")
    const { data: target } = await supabaseAdmin
        .from("workspace_memberships")
        .select("role")
        .eq("workspace_id", workspace.id)
        .eq("user_id", userId)
        .maybeSingle()
    if (!target) {
        revalidatePath(`/${slug}/settings`)
        return { ok: false, message: "That person is no longer in this workspace. Refresh the list." }
    }
    if (target.role === "owner") return { ok: false, message: "Owners cannot be removed here." }
    if (actingRole !== "owner" && normalizeWorkspaceRole(target.role) !== "staff") {
        return { ok: false, message: "Admins can only remove staff." }
    }
    const { error: removeError } = await supabaseAdmin
        .from("workspace_memberships")
        .delete()
        .eq("workspace_id", workspace.id)
        .eq("user_id", userId)
    if (removeError) {
        const fallback = removalRefusalMessage(removeError)
        const refusal = fallback ? (await workspaceRemovalBlockedMessage(workspace.id, userId)) ?? fallback : null
        if (!refusal) console.error("Workspace member removal failed", { workspaceId: workspace.id, userId, error: removeError.message })
        return { ok: false, message: refusal ?? "Betelgeze could not remove this person. Nothing was changed; try again." }
    }
    revalidatePath(`/${slug}/settings`)
    return { ok: true, message: "Removed from the workspace." }
}

export type OffboardWorkspaceMemberResult = { ok: true; message: string } | { ok: false; uncertain: boolean; message: string }

/**
 * Reassigns everything a member holds and removes them in one database transaction. The request id makes a retry after a
 * lost response return the original receipt instead of acting twice.
 */
export async function offboardWorkspaceMember(slug: string, input: OffboardInput): Promise<OffboardWorkspaceMemberResult> {
    const { workspace, user } = await requireUserManager(slug)
    if (user.id !== input.expectedUserId || !validOffboardInput(input)) {
        return { ok: false, uncertain: false, message: "Review who takes each assignment and add a reason." }
    }
    const { error } = await supabaseAdmin.rpc("offboard_workspace_member", {
        p_workspace: workspace.id, p_actor: user.id, p_request: input.requestId, p_target: input.targetId,
        p_input: { footprintFingerprint: input.footprintFingerprint, leaveOpenWork: input.leaveOpenWork, reason: input.reason.trim(), plan: input.plan },
    })
    if (error) {
        const definitive = /^[0-9A-Z]{5}$/.test(error.code ?? "")
        if (!definitive) console.error("Workspace member offboarding could not be confirmed", { workspaceId: workspace.id, targetId: input.targetId, error: error.message })
        return {
            ok: false, uncertain: !definitive,
            message: error.code === "P0001" ? error.message
                : error.code === "55P03" ? "Someone else is changing these clients. Nothing was moved; try again."
                : definitive ? "Betelgeze could not remove this person. Nothing was changed; try again."
                : "The removal could not be confirmed. Retry the same request to check whether it completed.",
        }
    }
    revalidatePath(`/${slug}/settings`)
    return { ok: true, message: "Assignments moved and the person was removed." }
}

/** Staff panel "Move to": moves some of a member's assignments and keeps their membership. Idempotent by request id. */
export async function reassignWorkspaceMemberItems(slug: string, input: ReassignInput): Promise<OffboardWorkspaceMemberResult> {
    const { workspace, user } = await requireUserManager(slug)
    if (user.id !== input.expectedUserId || !validReassignInput(input)) {
        return { ok: false, uncertain: false, message: "Choose who takes the selected assignments and add a reason." }
    }
    const { error } = await supabaseAdmin.rpc("reassign_workspace_member_items", {
        p_workspace: workspace.id, p_actor: user.id, p_request: input.requestId, p_source: input.sourceId,
        p_input: { reason: input.reason.trim(), plan: input.plan },
    })
    if (error) {
        const definitive = /^[0-9A-Z]{5}$/.test(error.code ?? "")
        if (!definitive) console.error("Staff reassignment could not be confirmed", { workspaceId: workspace.id, sourceId: input.sourceId, error: error.message })
        return {
            ok: false, uncertain: !definitive,
            message: error.code === "P0001" ? error.message
                : error.code === "55P03" ? "Someone else is changing these clients. Nothing was moved; try again."
                : definitive ? "Betelgeze could not move these assignments. Nothing was changed; try again."
                : "The move could not be confirmed. Retry the same request to check whether it completed.",
        }
    }
    revalidatePath(`/${slug}/staff`, "layout")
    return { ok: true, message: "Assignments moved." }
}

export type AdminMfaResetActionState = { ok: boolean; message: string }

async function performWorkspaceUserMfaReset(slug: string, formData: FormData) {
    const { workspace, role: actingRole, user: actor } = await requireUserManager(slug)
    const targetUserId = String(formData.get("userId") ?? "")
    const { data: targetMembership } = await supabaseAdmin.from("workspace_memberships").select("role").eq("workspace_id", workspace.id).eq("user_id", targetUserId).maybeSingle()
    const targetRole = normalizeWorkspaceRole(targetMembership?.role)
    if (!targetRole || targetRole === "owner") throw new Error("Owner MFA resets use the documented break-glass procedure.")
    if (actingRole === "admin" && targetRole !== "staff") throw new Error("Administrators can only reset staff MFA.")
    const { data: targetUser } = await supabaseAdmin.auth.admin.getUserById(targetUserId)
    const email = targetUser.user?.email?.toLowerCase()
    if (!email || String(formData.get("confirmation") ?? "") !== `RESET ${email}`) throw new Error("The MFA reset confirmation did not match.")
    const { data: factors, error: factorsError } = await supabaseAdmin.auth.admin.mfa.listFactors({ userId: targetUserId })
    if (factorsError) throw new Error("Betelgeze could not inspect that account's factors.")
    const { error: profileError } = await supabaseAdmin.from("user_profiles").update({ mfa_reenrollment_required: true, updated_at: new Date().toISOString() }).eq("user_id", targetUserId)
    if (profileError) throw new Error("Betelgeze could not safely require authenticator re-enrolment, so no factors were removed.")
    const deletionResults = await Promise.all(factors.factors.map(async (factor) => ({ factor, result: await supabaseAdmin.auth.admin.mfa.deleteFactor({ userId: targetUserId, id: factor.id }) })))
    const failures = deletionResults.filter(({ result }) => result.error)
    const removedCount = deletionResults.length - failures.length
    const { error: auditError } = await supabaseAdmin.from("account_security_events").insert({ user_id: targetUserId, actor_user_id: actor.id, workspace_id: workspace.id, event_type: "mfa_admin_reset", metadata: { requested_factor_count: factors.factors.length, removed_factor_count: removedCount, failed_factor_count: failures.length, actor_role: actingRole } })
    try { await sendSecurityNotice({ to: email, userId: targetUserId, heading: failures.length ? "Your Betelgeze authenticator reset needs review" : "Your Betelgeze authenticator was reset", body: failures.length ? `A ${workspace.name} administrator requested an authenticator reset, but not every factor could be removed. Your account is blocked from workspace access until the reset is reviewed and authenticator setup is completed.` : `A ${workspace.name} administrator removed the authenticator factors from your account. You must set up an authenticator again before accessing Betelgeze.` }) }
    catch (error) { console.error("MFA reset security notice failed", { workspaceId: workspace.id, targetUserId, error }) }
    revalidatePath(`/${slug}/settings`)
    if (failures.length) throw new Error("The MFA reset was only partially completed. Workspace access is blocked; review the account in Supabase before retrying.")
    if (auditError) throw new Error("The authenticators were reset, but the security audit record failed. Review the account before continuing.")
}

export async function resetWorkspaceUserMfa(slug: string, formData: FormData): Promise<AdminMfaResetActionState> {
    try {
        await performWorkspaceUserMfaReset(slug, formData)
        return { ok: true, message: "Authenticator reset complete. The user must enrol again before workspace access." }
    } catch (error) {
        console.error("Administrative MFA reset failed", { slug, error })
        return {
            ok: false,
            message: error instanceof Error ? error.message : "The authenticator reset could not be completed safely.",
        }
    }
}
