# Workspace performance route and action inventory

Generated with `node scripts/inventory-workspace-performance.mjs`. Regenerate after adding routes/actions. This is a complete static inventory of discovered source boundaries, **not a claim that routes are migrated, permission-audited or fast**.

Found **54 pages**, **92 HTTP route handlers** and **146 server actions**. The companion JSON includes each direct database table, loader/command call, client child and transitive server dependency. Type-only imports and imported Server Action proxies are excluded from client extraction blockers. Runtime dynamic imports, helper internals and background subscription lifecycles still require flow-level review.

**16 existing product page patterns** have native client views and authorized JSON loaders. They remain gated by `WORKSPACE_NATIVE_PANELS`; unset preserves the previous frame path. Onboarding management, Settings and LeadGen native views remain unimplemented. Communications receives shared read/history/lifecycle improvements but still uses its existing frame route. Standalone builder and public/token routes retain their separate boundaries. Any local validation fixture is explicitly listed and is not product-route or authenticated evidence.

The presentation-boundary column describes the original page source, which deliberately remains available for rollback. An extracted native view does not remove its original server-only imports. Native implementation evidence, enablement gates and remaining checks are recorded separately in the JSON.

## Page extraction matrix

| Route | Surface | Implementation state | Original presentation boundary | Direct loaders / guards |
| --- | --- | --- | --- | --- |
| `/[workspaceSlug]/admin/activity/[eventId]` | staff workspace | implemented; gated | extract server loader + serializable view model before native import | `getAdminActivityEvent`, `listCorrelatedAdminActivity`, `requireWorkspace` |
| `/[workspaceSlug]/admin/activity` | staff workspace | implemented; gated | extract server loader + serializable view model before native import | `getAdminActivityFacets`, `listAdminActivityPage`, `listAdminActivitySince`, `loadActivityTrends`, `requireWorkspace` |
| `/[workspaceSlug]/admin/maintenance` | staff workspace | implemented; gated | extract server loader + serializable view model before native import | `listMaintenanceWorkItems`, `requireWorkspace` |
| `/[workspaceSlug]/admin/okrs/[okrId]` | staff workspace | implemented; gated | extract server loader + serializable view model before native import | `getWorkspaceOkr`, `requireWorkspace` |
| `/[workspaceSlug]/admin/okrs` | staff workspace | implemented; gated | extract server loader + serializable view model before native import | `listWorkspaceOkrs`, `requireWorkspace` |
| `/[workspaceSlug]/admin` | staff workspace | implemented; gated | extract server loader + serializable view model before native import | `listAdminWorkItems`, `listWorkspaceOkrs`, `requireWorkspace` |
| `/[workspaceSlug]/appointment-setting/[relationshipId]` | staff workspace | implemented; gated | extract server loader + serializable view model before native import | `getRelationship`, `listAppointmentSettingAppointments`, `loadAppointmentSettingConfiguration`, `loadAppointmentSettingDeliveryState`, `loadAppointmentSettingRelationshipService`, `requireRelationshipAccess`, `requireWorkspacePanel` |
| `/[workspaceSlug]/appointment-setting` | staff workspace | implemented; gated | extract server loader + serializable view model before native import | `accessibleRelationshipIds`, `listRelationshipsForWorkspace`, `loadAppointmentSettingRelationshipServices`, `requireWorkspacePanel` |
| `/[workspaceSlug]/assets/[id]` | staff workspace | implemented; gated | extract server loader + serializable view model before native import | `accessibleAssetIds`, `accessibleRelationshipIds`, `accessibleWorkItemIds`, `createUploadSignedUrl`, `getAsset`, `getRelationship`, `listAssetRelationships`, `listAssetWorkItems`, `requireWorkspaceAccess` |
| `/[workspaceSlug]/assets` | staff workspace | implemented; gated | extract server loader + serializable view model before native import | `createUploadSignedUrl`, `listWorkspaceAssets`, `requireWorkspacePanel` |
| `/[workspaceSlug]/communications` | staff workspace | shared path optimizations implemented; native migration remaining | extract server loader + serializable view model before native import | `loadClientCommunicationsBootstrap`, `loadNativeCommunications`, `requireWorkspacePanel` |
| `/[workspaceSlug]/leadgen/new` | staff workspace | native migration remaining | extract server loader + serializable view model before native import | `requireWorkspace` |
| `/[workspaceSlug]/leadgen` | staff workspace | native migration remaining | extract server loader + serializable view model before native import | `requireWorkspace` |
| `/[workspaceSlug]/leadgen/poll/[pollId]` | staff workspace | native migration remaining | extract server loader + serializable view model before native import | `countSourceKeys`, `requireWorkspace` |
| `/[workspaceSlug]/leadgen/polls` | staff workspace | native migration remaining | extract server loader + serializable view model before native import | `requireWorkspace` |
| `/[workspaceSlug]/no-access` | staff workspace | native migration remaining | extract server loader + serializable view model before native import | `requireWorkspaceAccess` |
| `/[workspaceSlug]/onboarding-builder` | standalone builder | existing standalone boundary retained | extract server loader + serializable view model before native import | `createPrivateUploadSignedUrl`, `loadOnboardingBuilderData`, `loadWorkspaceClientBrandAssets`, `loadWorkspacePublicBranding`, `requireWorkspace` |
| `/[workspaceSlug]/onboarding/[relationshipId]` | staff workspace | native migration remaining | extract server loader + serializable view model before native import | `accessibleRelationshipIds`, `getOnboardingForm`, `getOnboardingStepsForModules`, `getOnboardingUrl`, `getProgressPercentage`, `getRelationship`, `loadNormalizedSessionSnapshot`, `loadOnboardingServiceRevisionDisplays`, `requireWorkspacePanel` |
| `/[workspaceSlug]/onboarding` | staff workspace | native migration remaining | extract server loader + serializable view model before native import | `accessibleRelationshipIds`, `getOnboardingStepsForModules`, `getOnboardingUrl`, `getProgressPercentage`, `listRelationshipsForWorkspace`, `loadOnboardingDetails`, `loadOnboardingServiceRevisionDisplays`, `recordIsInScope`, `requireWorkspacePanel` |
| `/[workspaceSlug]` | staff workspace | native migration remaining | extract server loader + serializable view model before native import | `requireWorkspaceAccess` |
| `/[workspaceSlug]/relationships/[relationshipId]` | staff workspace | implemented; gated | extract server loader + serializable view model before native import | `createPrivateUploadSignedUrl`, `getRelationship`, `getRelationshipGanttPlan`, `loadOnboardingServiceRevisionDisplays`, `loadPublishedOnboardingConfiguration`, `loadWorkspaceClientBrandAssets`, `loadWorkspaceOperations`, `loadWorkspacePublicBranding`, `requireRelationshipAccess`, `requireWorkspacePanel` |
| `/[workspaceSlug]/relationships` | staff workspace | implemented; gated | extract server loader + serializable view model before native import | `accessibleRelationshipIds`, `countOpenWorkItemsByRelationship`, `listRelationshipsForWorkspace`, `loadOnboardingServiceRevisionDisplays`, `loadRelationshipEnrichment`, `requireWorkspacePanel` |
| `/[workspaceSlug]/settings` | staff workspace | native migration remaining | extract server loader + serializable view model before native import | `createUploadSignedUrl`, `listWorkspaceConnections`, `loadLeadgenSettingsPageData`, `loadOnboardingSettingsPageData`, `loadWorkspaceClientBrandAssets`, `loadWorkspaceOperations`, `loadWorkspacePublicBranding`, `requireWorkspace` |
| `/[workspaceSlug]/work-items/[id]` | staff workspace | implemented; gated | extract server loader + serializable view model before native import | `accessibleRelationshipIds`, `accessibleWorkItemIds`, `createUploadSignedUrls`, `getRelationship`, `getWorkItem`, `getWorkItemPlanningContext`, `listWorkItemAssets`, `listWorkItemKeyResultLinks`, `listWorkItemRelationships`, `requireWorkspaceAccess` |
| `/[workspaceSlug]/work-items` | staff workspace | implemented; gated | extract server loader + serializable view model before native import | `listWorkspaceWorkItems`, `requireWorkspacePanel` |
| `/[workspaceSlug]/work/[relationshipId]` | staff workspace | implemented; gated | extract server loader + serializable view model before native import | `accessibleWorkItemIds`, `getRelationship`, `listRelationshipTimelineItems`, `requireRelationshipAccess`, `requireWorkspacePanel` |
| `/[workspaceSlug]/work` | staff workspace | implemented; gated | extract server loader + serializable view model before native import | `accessibleRelationshipIds`, `accessibleWorkItemIds`, `listWorkQueueItems`, `requireWorkspacePanel` |
| `/check-email` | account/public | existing standalone boundary retained | review presentation extraction | — |
| `/client-portal/session/[token]` | token/public boundary | existing standalone boundary retained | extract server loader + serializable view model before native import | `loadClientPagePublicBranding`, `loadClientPortalSessionByToken`, `loadWorkspaceClientBrandAssets`, `loadWorkspacePublicBranding` |
| `/email-confirmed` | account/public | existing standalone boundary retained | review presentation extraction | — |
| `/forgot-password/[step]` | account/public | existing standalone boundary retained | extract server loader + serializable view model before native import | — |
| `/forgot-password` | account/public | existing standalone boundary retained | review presentation extraction | — |
| `/install` | account/public | existing standalone boundary retained | extract server loader + serializable view model before native import | — |
| `/invites/accept` | account/public | existing standalone boundary retained | review presentation extraction | — |
| `/login` | account/public | existing standalone boundary retained | extract server loader + serializable view model before native import | — |
| `/mfa` | account/public | existing standalone boundary retained | client view exists; audit navigation/session assumptions | `resolveClientDestination` |
| `/onboarding/preview/[token]` | token/public boundary | existing standalone boundary retained | extract server loader + serializable view model before native import | `createHash`, `createPrivateUploadSignedUrl`, `loadOnboardingBuilderData`, `loadPublishedOnboardingConfiguration`, `loadWorkspaceClientBrandAssets`, `loadWorkspacePublicBranding`, `resolveBlocks` |
| `/onboarding/session/[token]` | token/public boundary | existing standalone boundary retained | extract server loader + serializable view model before native import | `createPrivateUploadSignedUrl`, `getCanonicalSessionByToken`, `getCanonicalStepDraft`, `getClientPortalUrlForOnboardingSession`, `getFormResponseAsset`, `getFrozenOnboardingPaymentDefinition`, `getOnboardingForm`, `getOnboardingPaymentContext`, `loadClientPagePublicBranding`, `loadWorkspaceClientBrandAssets`, `loadWorkspacePublicBranding` |
| `/onboarding/smsoptin` | account/public | existing standalone boundary retained | extract server loader + serializable view model before native import | `getPublicSmsOptInWorkspace`, `loadWorkspaceClientBrandAssets` |
| `/` | account/public | existing standalone boundary retained | review presentation extraction | — |
| `/payment/cancelled` | account/public | existing standalone boundary retained | review presentation extraction | — |
| `/payment/complete` | account/public | existing standalone boundary retained | review presentation extraction | — |
| `/privacy` | account/public | existing standalone boundary retained | review presentation extraction | — |
| `/session/[token]` | account/public | existing standalone boundary retained | review presentation extraction | — |
| `/sign-up/[step]` | account/public | existing standalone boundary retained | extract server loader + serializable view model before native import | `getOnboardingContext` |
| `/sign-up` | account/public | existing standalone boundary retained | extract server loader + serializable view model before native import | `getOnboardingContext` |
| `/terms` | account/public | existing standalone boundary retained | review presentation extraction | — |
| `/update-password` | account/public | existing standalone boundary retained | review presentation extraction | — |
| `/users/[username]/create-dashboard` | account/public | existing standalone boundary retained | extract server loader + serializable view model before native import | `getCurrentUser` |
| `/users/[username]/edit` | account/public | existing standalone boundary retained | extract server loader + serializable view model before native import | `createUploadSignedUrl`, `getCurrentUser` |
| `/users/[username]` | account/public | existing standalone boundary retained | extract server loader + serializable view model before native import | `createUploadSignedUrl`, `getCurrentUser` |
| `/users/[username]/security` | account/public | existing standalone boundary retained | extract server loader + serializable view model before native import | `getCurrentUser` |
| `/workspaces` | account/public | existing standalone boundary retained | extract server loader + serializable view model before native import | `createSupabaseServerClient`, `requireAal2User` |
| `/~workspace-shell/[workspaceSlug]` | staff workspace | mixed native/frame shell implemented; gated | extract server loader + serializable view model before native import | `requireWorkspaceShellBootstrap` |

## HTTP route handlers

Completion is endpoint-specific: GET readiness, authoritative transaction, job acceptance and provider delivery are separate events. The listed calls identify review entry points, not proof that all downstream checks execute on every path.

| Source | Methods | Implementation state | Calls to review |
| --- | --- | --- | --- |
| `app/api/account/onboarding/complete/route.ts` | `POST` | existing endpoint retained; completion semantics require per-flow review | `createSupabaseRouteClient` |
| `app/api/account/onboarding/route.ts` | `POST` | existing endpoint retained; completion semantics require per-flow review | `createSupabaseRouteClient`, `getOnboardingContext`, `updateOnboardingSession` |
| `app/api/account/username/route.ts` | `GET` | existing endpoint retained; completion semantics require per-flow review | `getOnboardingContext` |
| `app/api/account/welcome/route.ts` | `POST` | existing endpoint retained; completion semantics require per-flow review | `createSupabaseRouteClient`, `getAal2User` |
| `app/api/auth/login/route.ts` | `POST` | existing endpoint retained; completion semantics require per-flow review | `createSupabaseRouteClient` |
| `app/api/auth/mfa/route.ts` | `GET`, `POST`, `DELETE` | existing endpoint retained; completion semantics require per-flow review | `createSupabaseRouteClient`, `getOnboardingContext`, `updateOnboardingSession` |
| `app/api/auth/recovery/route.ts` | `POST` | existing endpoint retained; completion semantics require per-flow review | `createAccountToken`, `createClient`, `createSupabaseRouteClient`, `getRequiredEnv`, `sendPasswordChangedNotice` |
| `app/api/auth/send-email-hook/route.ts` | `POST` | existing endpoint retained; completion semantics require per-flow review | `sendAccountEmail`, `sendHookEmail` |
| `app/api/auth/session-recovery/route.ts` | `POST` | existing endpoint retained; completion semantics require per-flow review | — |
| `app/api/client-branding/favicon/[surface]/[token]/route.ts` | `GET` | existing endpoint retained; completion semantics require per-flow review | `resolveClientFavicon` |
| `app/api/client-branding/logo/[surface]/[token]/route.ts` | `GET` | existing endpoint retained; completion semantics require per-flow review | `resolveClientBrandAsset` |
| `app/api/client-messages/clickup/chat/route.ts` | `POST` | existing endpoint retained; completion semantics require per-flow review | — |
| `app/api/client-messages/clickup/outbound/route.ts` | `POST` | existing endpoint retained; completion semantics require per-flow review | — |
| `app/api/client-messages/clickup/poll/route.ts` | `GET` | existing endpoint retained; completion semantics require per-flow review | — |
| `app/api/client-messages/media/[...path]/route.ts` | `GET`, `HEAD` | existing endpoint retained; completion semantics require per-flow review | `createEncryptedPrivateUploadSignedRequest`, `createPrivateUploadSignedUrl`, `ensureCommunicationImagePreview`, `getCurrentUser`, `getMediaHeaders`, `getSafeFileName`, `loadCommunicationMediaRepresentation`, `loadMediaResponse` |
| `app/api/client-messages/meta/whatsapp/route.ts` | `GET`, `POST` | existing endpoint retained; completion semantics require per-flow review | `getEquivalentMessageAddresses`, `getExtensionFromMimeType`, `getFirstBusinessAddress`, `getFirstStatusRecipientAddress`, `getInboundMessageContent`, `getInboundText`, `getMediaPayload`, `getMessageTimestampMs`, `getMetaWhatsAppMedia`, `getStatusError`, `getWorkspaceIdForWhatsAppPhoneNumber`, `recordClientAdminActivity`, `recordWorkspaceConnectionWebhook`, `resolveInboundDestination` |
| `app/api/client-messages/twilio/route.ts` | `POST` | existing endpoint retained; completion semantics require per-flow review | `getEquivalentMessageAddresses`, `getWorkspaceIdForTwilioNumber`, `loadWorkspacePublicBranding`, `recordSmsOptOut`, `recordWorkspaceConnectionWebhook`, `resolveDestination` |
| `app/api/client-portal/session/[token]/appointments/route.ts` | `GET` | existing endpoint retained; completion semantics require per-flow review | `resolveClientPortalAccessByToken` |
| `app/api/client-portal/session/[token]/checklist/route.ts` | `PATCH` | existing endpoint retained; completion semantics require per-flow review | `resolveClientPortalAccessByToken`, `updateChatCheckbox` |
| `app/api/client-portal/session/[token]/messages/[messageId]/attachment/route.ts` | `GET`, `HEAD` | existing endpoint retained; completion semantics require per-flow review | `createEncryptedPrivateUploadSignedRequest`, `createPrivateUploadSignedUrl`, `loadAttachment`, `loadClientPortalAttachmentAccess`, `resolveClientPortalAccessByToken` |
| `app/api/client-portal/session/[token]/messages/route.ts` | `GET`, `POST`, `DELETE` | existing endpoint retained; completion semantics require per-flow review | `loadClientPortalMessages`, `recordClientAdminActivity`, `resolveClientPortalAccessByToken` |
| `app/api/client-portal/session/[token]/reactions/route.ts` | `POST` | existing endpoint retained; completion semantics require per-flow review | `resolveClientPortalAccessByToken` |
| `app/api/client-portal/session/[token]/resources/[resourceId]/route.ts` | `GET` | existing endpoint retained; completion semantics require per-flow review | `createPrivateResourceDownloadUrl`, `resolveClientPortalAccessByToken` |
| `app/api/client-portal/session/[token]/resources/multipart/route.ts` | `POST` | existing endpoint retained; completion semantics require per-flow review | `completeResourceMultipart`, `ensurePlatformDirectUploads`, `getRequiredEnv`, `resolveClientPortalAccessByToken` |
| `app/api/client-portal/session/[token]/resources/route.ts` | `GET`, `POST` | existing endpoint retained; completion semantics require per-flow review | `createSignedClientPortalResourceUpload`, `ensurePlatformDirectUploads`, `getRequiredEnv`, `resolveClientPortalAccessByToken` |
| `app/api/communications/activity/route.ts` | `POST` | existing endpoint retained; completion semantics require per-flow review | `getCurrentUser` |
| `app/api/cron/appointment-notifications/route.ts` | — | durable worker implemented; migration, scheduler and outbox readiness flag required | `processAppointmentNotificationOutbox` |
| `app/api/cron/onboarding-outbox/route.ts` | `GET`, `POST` | existing endpoint retained; completion semantics require per-flow review | `processAllOnboardingOutboxes`, `processRequest` |
| `app/api/email/resend-webhook/route.ts` | `POST` | existing endpoint retained; completion semantics require per-flow review | `deliveryStatus` |
| `app/api/leadgen/polls/process/route.ts` | `POST` | existing endpoint retained; completion semantics require per-flow review | `createSupabaseServerClient`, `getAal2User`, `processLeadgenPoll` |
| `app/api/leadgen/sunbiz/import/route.ts` | `POST` | existing endpoint retained; completion semantics require per-flow review | — |
| `app/api/offline/session/route.ts` | `GET` | existing endpoint retained; completion semantics require per-flow review | `createSupabaseRouteClient` |
| `app/api/onboarding/meta-ads/callback/route.ts` | `GET` | existing endpoint retained; completion semantics require per-flow review | `createHash`, `getMetaAdsAdAccountOptions`, `getMetaAdsBusinessOptions` |
| `app/api/onboarding/session/[token]/checkout/route.ts` | `GET` | existing endpoint retained; completion semantics require per-flow review | `createOrReuseOnboardingCheckout`, `getOnboardingPaymentReturnUrl` |
| `app/api/onboarding/session/[token]/meta-ads/start/route.ts` | `GET` | existing endpoint retained; completion semantics require per-flow review | `createHash`, `getCanonicalSessionByToken` |
| `app/api/onboarding/session/[token]/payment-return/route.ts` | `GET` | existing endpoint retained; completion semantics require per-flow review | `getOnboardingPaymentReturnUrl` |
| `app/api/onboarding/session/[token]/submit/route.ts` | `POST` | existing endpoint retained; completion semantics require per-flow review | `completeCanonicalStep`, `getCanonicalMutationSessionByToken`, `submitCanonicalFormStep` |
| `app/api/profile-avatars/[username]/route.ts` | `GET` | existing endpoint retained; completion semantics require per-flow review | — |
| `app/api/push/subscriptions/route.ts` | `GET`, `POST`, `DELETE` | existing endpoint retained; completion semantics require per-flow review | `getCurrentUser` |
| `app/api/stripe/webhook/route.ts` | `POST` | existing endpoint retained; completion semantics require per-flow review | `getStripeWebhookCandidates`, `getWorkspaceIdForConnectedAccount`, `recordAdminActivity`, `recordWorkspaceConnectionWebhook`, `verifyStripeWebhookSignature` |
| `app/api/workspace-connections/meta-ads/callback/route.ts` | `GET` | existing endpoint retained; completion semantics require per-flow review | `getMetaAdsBusinessOptions`, `requireWorkspace` |
| `app/api/workspace-connections/meta-ads/start/route.ts` | `GET` | existing endpoint retained; completion semantics require per-flow review | `createConnectionAttempt`, `requireWorkspace` |
| `app/api/workspace-connections/stripe/callback/route.ts` | `GET` | existing endpoint retained; completion semantics require per-flow review | `requireWorkspace`, `verifyAndActivateWorkspaceIntegrationCandidate` |
| `app/api/workspace-connections/stripe/start/route.ts` | `GET` | existing endpoint retained; completion semantics require per-flow review | `createConnectionAttempt`, `requireWorkspace` |
| `app/api/workspaces/[workspaceSlug]/activity/errors/route.ts` | `POST` | existing endpoint retained; completion semantics require per-flow review | `requireWorkspace` |
| `app/api/workspaces/[workspaceSlug]/activity/mutations/route.ts` | `POST` | existing endpoint retained; completion semantics require per-flow review | `recordAdminActivity`, `requireWorkspace` |
| `app/api/workspaces/[workspaceSlug]/activity/presence/route.ts` | `POST` | existing endpoint retained; completion semantics require per-flow review | `recordAdminActivity`, `requireWorkspace` |
| `app/api/workspaces/[workspaceSlug]/appointment-setting/[relationshipId]/draft/route.ts` | `POST` | versioned command implemented; gated client, receipt migration and staged checks required | `saveAppointmentSettingDraft` |
| `app/api/workspaces/[workspaceSlug]/appointment-setting/[relationshipId]/route.ts` | `GET` | existing endpoint retained; completion semantics require per-flow review | `getRelationship`, `listAppointmentSettingAppointments`, `loadAppointmentSettingDeliveryState`, `loadAppointmentSettingRelationshipService`, `requireRelationshipAccess`, `requireWorkspacePanel` |
| `app/api/workspaces/[workspaceSlug]/appointment-setting/[relationshipId]/submit/route.ts` | `POST` | versioned command implemented; gated client, receipt migration and staged checks required | `submitAppointmentSettingAppointment` |
| `app/api/workspaces/[workspaceSlug]/assets/[assetId]/download/route.ts` | `GET` | existing endpoint retained; completion semantics require per-flow review | `accessibleAssetIds`, `accessibleRelationshipIds`, `accessibleWorkItemIds`, `createPrivateResourceDownloadUrl`, `getAsset`, `requireWorkspaceAccess` |
| `app/api/workspaces/[workspaceSlug]/assets/upload/route.ts` | `POST` | existing endpoint retained; completion semantics require per-flow review | `createSignedAssetUpload`, `ensurePlatformDirectUploads`, `requireWorkspace` |
| `app/api/workspaces/[workspaceSlug]/communications/attachments/route.ts` | `POST`, `DELETE` | existing endpoint retained; completion semantics require per-flow review | `createSignedClientMessageUpload`, `deleteOnboardingUploads`, `ensurePlatformDirectUploads`, `requireWorkspacePanel` |
| `app/api/workspaces/[workspaceSlug]/communications/checklist/route.ts` | `PATCH` | existing endpoint retained; completion semantics require per-flow review | `loadCommunicationMessage`, `requireWorkspacePanel`, `updateChatCheckbox` |
| `app/api/workspaces/[workspaceSlug]/communications/messages/route.ts` | `GET`, `POST` | history path optimized; migration and authenticated behavior checks required | `createCommunicationMediaGrant`, `loadCommunicationMessage`, `loadCommunicationMessagePage`, `loadCommunicationMessages`, `recordClientAdminActivity`, `requireWorkspacePanel`, `resolveCommunicationDestinations`, `sendCommunicationDeliveries`, `verifyClientMessageUpload` |
| `app/api/workspaces/[workspaceSlug]/communications/native/attachments/route.ts` | `POST`, `DELETE` | existing endpoint retained; completion semantics require per-flow review | `createSignedNativeMessageUpload`, `deleteOnboardingUploads`, `ensurePlatformDirectUploads`, `requireWorkspacePanel` |
| `app/api/workspaces/[workspaceSlug]/communications/native/checklist/route.ts` | `PATCH` | existing endpoint retained; completion semantics require per-flow review | `loadNativeMessageForCurrentUser`, `requireWorkspacePanel`, `updateChatCheckbox` |
| `app/api/workspaces/[workspaceSlug]/communications/native/clear/route.ts` | `POST` | existing endpoint retained; completion semantics require per-flow review | `createSupabaseServerClient`, `requireWorkspacePanel` |
| `app/api/workspaces/[workspaceSlug]/communications/native/conversations/route.ts` | `GET`, `POST` | existing endpoint retained; completion semantics require per-flow review | `loadNativeCommunications`, `requireWorkspacePanel` |
| `app/api/workspaces/[workspaceSlug]/communications/native/messages/route.ts` | `GET`, `POST`, `PATCH`, `DELETE` | history path optimized; migration and authenticated behavior checks required | `createSupabaseServerClient`, `deleteOnboardingUploads`, `loadNativeMessageForCurrentUser`, `loadNativeMessagePage`, `loadNativeMessagesForCurrentUser`, `requireWorkspacePanel`, `verifyNativeMessageUpload` |
| `app/api/workspaces/[workspaceSlug]/communications/native/pins/route.ts` | `POST` | existing endpoint retained; completion semantics require per-flow review | `requireWorkspacePanel` |
| `app/api/workspaces/[workspaceSlug]/communications/native/reactions/route.ts` | `POST` | existing endpoint retained; completion semantics require per-flow review | `requireWorkspacePanel` |
| `app/api/workspaces/[workspaceSlug]/communications/native/read/route.ts` | `POST` | existing endpoint retained; completion semantics require per-flow review | `requireWorkspacePanel` |
| `app/api/workspaces/[workspaceSlug]/communications/participants/route.ts` | `POST` | existing endpoint retained; completion semantics require per-flow review | `requireWorkspacePanel` |
| `app/api/workspaces/[workspaceSlug]/communications/pins/route.ts` | `POST` | existing endpoint retained; completion semantics require per-flow review | `requireWorkspacePanel` |
| `app/api/workspaces/[workspaceSlug]/communications/reactions/route.ts` | `POST` | existing endpoint retained; completion semantics require per-flow review | `requireWorkspacePanel`, `sendMetaWhatsAppReaction` |
| `app/api/workspaces/[workspaceSlug]/communications/read/route.ts` | `POST` | existing endpoint retained; completion semantics require per-flow review | `requireWorkspacePanel` |
| `app/api/workspaces/[workspaceSlug]/communications/stickers/route.ts` | `GET`, `POST` | existing endpoint retained; completion semantics require per-flow review | `deleteOnboardingUploads`, `loadCommunicationMessages`, `requireWorkspacePanel`, `saveStickerFromMessage`, `savedSticker` |
| `app/api/workspaces/[workspaceSlug]/communications/sync/route.ts` | `GET` | existing endpoint retained; completion semantics require per-flow review | `loadClientCommunicationsBootstrap`, `requireWorkspacePanel` |
| `app/api/workspaces/[workspaceSlug]/communications/typing/route.ts` | `POST` | existing endpoint retained; completion semantics require per-flow review | `requireWorkspacePanel`, `sendMetaWhatsAppTypingIndicator` |
| `app/api/workspaces/[workspaceSlug]/members/[userId]/profile/route.ts` | `GET` | existing endpoint retained; completion semantics require per-flow review | `requireWorkspace` |
| `app/api/workspaces/[workspaceSlug]/onboarding-builder/updates/route.ts` | `GET`, `POST` | existing endpoint retained; completion semantics require per-flow review | `loadVisualBuilderUpdates` |
| `app/api/workspaces/[workspaceSlug]/panels/admin/route.ts` | `GET` | authorized JSON loader implemented; selected by gated native client | `loadNativeAdmin`, `loadNativeAdminTrends` |
| `app/api/workspaces/[workspaceSlug]/panels/appointment-setting/route.ts` | `GET` | authorized JSON loader implemented; selected by gated native client | `loadNativeAppointment` |
| `app/api/workspaces/[workspaceSlug]/panels/library/route.ts` | `GET` | authorized JSON loader implemented; selected by gated native client | `loadNativeLibrary` |
| `app/api/workspaces/[workspaceSlug]/panels/relationships/route.ts` | `GET` | authorized JSON loader implemented; selected by gated native client | `loadNativeRelationships` |
| `app/api/workspaces/[workspaceSlug]/panels/work/route.ts` | `GET` | authorized JSON loader implemented; selected by gated native client | `loadNativeWork` |
| `app/api/workspaces/[workspaceSlug]/performance/interactions/route.ts` | `POST` | content-free telemetry implemented; interaction table migration required for persistence | `requireWorkspace` |
| `app/api/workspaces/[workspaceSlug]/performance/launch/route.ts` | `POST` | content-free telemetry implemented; interaction table migration required for persistence | `requireWorkspace` |
| `app/api/workspaces/[workspaceSlug]/relationships/[relationshipId]/background/route.ts` | `POST` | versioned command implemented; gated client, receipt migration and staged checks required | `saveRelationshipBackgroundCommand` |
| `app/api/workspaces/[workspaceSlug]/retention-create-options/route.ts` | `GET` | existing endpoint retained; completion semantics require per-flow review | `loadWorkspaceOperations`, `requireWorkspaceAccess` |
| `app/api/workspaces/[workspaceSlug]/search/route.ts` | `GET` | existing endpoint retained; completion semantics require per-flow review | `accessibleRelationshipIds`, `accessibleWorkItemIds`, `createSupabaseServerClient`, `getAal2User`, `listRelationshipsForWorkspace`, `loadWorkspaceAccess`, `requireSearchWorkspace` |
| `app/api/workspaces/[workspaceSlug]/service-thumbnails/upload/route.ts` | `POST` | existing endpoint retained; completion semantics require per-flow review | `createSignedServiceThumbnailUpload`, `ensurePlatformDirectUploads`, `requireWorkspace` |
| `app/api/workspaces/[workspaceSlug]/shell-create-options/route.ts` | `GET` | existing endpoint retained; completion semantics require per-flow review | `accessibleRelationshipIds`, `accessibleWorkItemIds`, `requireWorkspaceAccess` |
| `app/api/workspaces/[workspaceSlug]/shell-secondary/route.ts` | `GET` | existing endpoint retained; completion semantics require per-flow review | `createUploadSignedUrl`, `requireWorkspace` |
| `app/api/workspaces/[workspaceSlug]/teams/route.ts` | `POST` | existing endpoint retained; completion semantics require per-flow review | `requireWorkspace` |
| `app/api/workspaces/[workspaceSlug]/users/lookup/route.ts` | `GET` | existing endpoint retained; completion semantics require per-flow review | `requireWorkspace` |
| `app/api/workspaces/[workspaceSlug]/work-items/[id]/editor-options/route.ts` | `GET` | existing endpoint retained; completion semantics require per-flow review | `accessibleRelationshipIds`, `accessibleWorkItemIds`, `getWorkItem`, `listActiveWorkspaceKeyResults`, `listRelationshipsForWorkspace`, `listWorkItemEditorCandidates`, `requireWorkspaceAccess` |
| `app/auth/callback/route.ts` | `GET` | existing endpoint retained; completion semantics require per-flow review | `createSupabaseRouteClient`, `getOnboardingContext`, `updateOnboardingSession` |
| `app/invitation/route.ts` | `GET` | existing endpoint retained; completion semantics require per-flow review | — |
| `app/logout/route.ts` | `GET`, `POST` | existing endpoint retained; completion semantics require per-flow review | `createSupabaseRouteClient` |
| `lib/supabase/route.ts` | — | existing endpoint retained; completion semantics require per-flow review | `createServerClient` |

## Server actions

Each exported or inline action is listed independently. Detailed guards/tables are available by source in the JSON. Before migrating an action, classify its irreversible transitions, external effects, expected version and idempotency requirements. This list does not claim every action received a new command transport. Appointment draft/submit and relationship background commands are the implemented gated command paths; OKR modal deletion now has an inline response with its existing server authority and a conditional draft-only delete. Other action implementations retain their existing behavior unless specifically described in the PR.

| Source | Action | Boundary |
| --- | --- | --- |
| `app/[workspaceSlug]/admin/actions.ts` | `createOkrFromModal` | exported action |
| `app/[workspaceSlug]/admin/actions.ts` | `createOkr` | exported action |
| `app/[workspaceSlug]/admin/actions.ts` | `updateOkr` | exported action |
| `app/[workspaceSlug]/admin/actions.ts` | `updateActiveOkrDetails` | exported action |
| `app/[workspaceSlug]/admin/actions.ts` | `commitOkr` | exported action |
| `app/[workspaceSlug]/admin/actions.ts` | `deleteOkrInline` | exported action |
| `app/[workspaceSlug]/admin/actions.ts` | `deleteOkr` | exported action |
| `app/[workspaceSlug]/admin/actions.ts` | `setOkrStatus` | exported action |
| `app/[workspaceSlug]/admin/actions.ts` | `addOkrKeyResult` | exported action |
| `app/[workspaceSlug]/admin/actions.ts` | `deleteOkrKeyResult` | exported action |
| `app/[workspaceSlug]/admin/actions.ts` | `updateOkrKeyResult` | exported action |
| `app/[workspaceSlug]/admin/actions.ts` | `updateDraftOkrKeyResultMetric` | exported action |
| `app/[workspaceSlug]/admin/actions.ts` | `updateActiveOkrKeyResultDescription` | exported action |
| `app/[workspaceSlug]/admin/actions.ts` | `setOkrKeyResultCadence` | exported action |
| `app/[workspaceSlug]/admin/actions.ts` | `addOkrMeasurement` | exported action |
| `app/[workspaceSlug]/admin/actions.ts` | `createOkrAction` | exported action |
| `app/[workspaceSlug]/admin/actions.ts` | `linkOkrAction` | exported action |
| `app/[workspaceSlug]/admin/actions.ts` | `unlinkOkrAction` | exported action |
| `app/[workspaceSlug]/appointment-setting/[relationshipId]/actions.ts` | `createAppointmentSettingDraft` | exported action |
| `app/[workspaceSlug]/appointment-setting/[relationshipId]/actions.ts` | `updateAppointmentSettingAppointment` | exported action |
| `app/[workspaceSlug]/appointment-setting/[relationshipId]/actions.ts` | `saveAppointmentSettingDraft` | exported action |
| `app/[workspaceSlug]/appointment-setting/[relationshipId]/actions.ts` | `submitAppointmentSettingAppointment` | exported action |
| `app/[workspaceSlug]/appointment-setting/[relationshipId]/actions.ts` | `deleteAppointmentSettingAppointment` | exported action |
| `app/[workspaceSlug]/leadgen/actions.ts` | `createLeadgenPoll` | exported action |
| `app/[workspaceSlug]/leadgen/actions.ts` | `cancelLeadgenPoll` | exported action |
| `app/[workspaceSlug]/leadgen/actions.ts` | `retryLeadgenPoll` | exported action |
| `app/[workspaceSlug]/leadgen/actions.ts` | `removeLeadgenPoll` | exported action |
| `app/[workspaceSlug]/leadgen/actions.ts` | `removeLeadgenCompany` | exported action |
| `app/[workspaceSlug]/leadgen/actions.ts` | `promoteLeadgenCompanyToRelationship` | exported action |
| `app/[workspaceSlug]/leadgen/settings/actions.ts` | `updateLeadgenWorkspaceName` | exported action |
| `app/[workspaceSlug]/leadgen/settings/actions.ts` | `updateLeadgenCoverLayout` | exported action |
| `app/[workspaceSlug]/leadgen/settings/actions.ts` | `uploadLeadgenBanner` | exported action |
| `app/[workspaceSlug]/leadgen/settings/actions.ts` | `uploadSharedWorkspaceLogo` | exported action |
| `app/[workspaceSlug]/leadgen/settings/actions.ts` | `saveLeadgenSettings` | exported action |
| `app/[workspaceSlug]/onboarding-builder/actions.ts` | `createOnboardingModule` | exported action |
| `app/[workspaceSlug]/onboarding-builder/actions.ts` | `saveOnboardingModuleDraft` | exported action |
| `app/[workspaceSlug]/onboarding-builder/actions.ts` | `duplicateOnboardingModule` | exported action |
| `app/[workspaceSlug]/onboarding-builder/actions.ts` | `deleteOnboardingModuleDraft` | exported action |
| `app/[workspaceSlug]/onboarding-builder/actions.ts` | `removeOnboardingModule` | exported action |
| `app/[workspaceSlug]/onboarding-builder/actions.ts` | `publishOnboardingModule` | exported action |
| `app/[workspaceSlug]/onboarding-builder/actions.ts` | `archiveOnboardingModule` | exported action |
| `app/[workspaceSlug]/onboarding-builder/actions.ts` | `restoreOnboardingModule` | exported action |
| `app/[workspaceSlug]/onboarding-builder/actions.ts` | `saveOnboardingBookendDraft` | exported action |
| `app/[workspaceSlug]/onboarding-builder/actions.ts` | `publishOnboardingBookend` | exported action |
| `app/[workspaceSlug]/onboarding-builder/actions.ts` | `rotateOnboardingModulePreview` | exported action |
| `app/[workspaceSlug]/onboarding-builder/actions.ts` | `revokeOnboardingModulePreview` | exported action |
| `app/[workspaceSlug]/onboarding-builder/actions.ts` | `prepareBuilderVideoUpload` | exported action |
| `app/[workspaceSlug]/onboarding-builder/visual-actions.ts` | `publishVisualOnboardingRelease` | exported action |
| `app/[workspaceSlug]/onboarding-builder/visual-actions.ts` | `prepareVisualBuilderVideoUpload` | exported action |
| `app/[workspaceSlug]/onboarding-builder/visual-actions.ts` | `rotateVisualOnboardingPreview` | exported action |
| `app/[workspaceSlug]/onboarding-builder/visual-actions.ts` | `saveVisualThemeDraft` | exported action |
| `app/[workspaceSlug]/onboarding-builder/visual-actions.ts` | `publishVisualThemeDraft` | exported action |
| `app/[workspaceSlug]/onboarding/[relationshipId]/actions.ts` | `archiveOnboarding` | exported action |
| `app/[workspaceSlug]/onboarding/[relationshipId]/actions.ts` | `restartOnboarding` | exported action |
| `app/[workspaceSlug]/onboarding/[relationshipId]/actions.ts` | `revokeOnboardingToken` | exported action |
| `app/[workspaceSlug]/onboarding/[relationshipId]/actions.ts` | `rotateOnboardingToken` | exported action |
| `app/[workspaceSlug]/relationships/[relationshipId]/gantt-actions.ts` | `loadGanttPlan` | exported action |
| `app/[workspaceSlug]/relationships/[relationshipId]/gantt-actions.ts` | `previewGanttScheduleChange` | exported action |
| `app/[workspaceSlug]/relationships/[relationshipId]/gantt-actions.ts` | `applyGanttScheduleChanges` | exported action |
| `app/[workspaceSlug]/relationships/[relationshipId]/gantt-actions.ts` | `createGanttWorkItem` | exported action |
| `app/[workspaceSlug]/relationships/[relationshipId]/gantt-actions.ts` | `moveGanttWorkItem` | exported action |
| `app/[workspaceSlug]/relationships/[relationshipId]/gantt-actions.ts` | `createGanttDependency` | exported action |
| `app/[workspaceSlug]/relationships/[relationshipId]/gantt-actions.ts` | `removeGanttDependency` | exported action |
| `app/[workspaceSlug]/relationships/actions.ts` | `beginRelationshipPos` | exported action |
| `app/[workspaceSlug]/relationships/actions.ts` | `createRelationship` | exported action |
| `app/[workspaceSlug]/relationships/actions.ts` | `createRelationshipFromModal` | exported action |
| `app/[workspaceSlug]/relationships/actions.ts` | `requestRetentionMessagingConfirmation` | exported action |
| `app/[workspaceSlug]/relationships/actions.ts` | `saveRelationshipCommercialDetails` | exported action |
| `app/[workspaceSlug]/relationships/actions.ts` | `saveRelationshipDealDetails` | exported action |
| `app/[workspaceSlug]/relationships/actions.ts` | `saveRelationshipBackgroundDetails` | exported action |
| `app/[workspaceSlug]/relationships/actions.ts` | `archiveRelationship` | exported action |
| `app/[workspaceSlug]/relationships/actions.ts` | `archiveRelationshipForNativePanel` | exported action |
| `app/[workspaceSlug]/relationships/actions.ts` | `proceedRelationshipCurrentWork` | exported action |
| `app/[workspaceSlug]/relationships/actions.ts` | `startRelationshipOnboarding` | exported action |
| `app/[workspaceSlug]/relationships/actions.ts` | `createRelationshipWorkItem` | exported action |
| `app/[workspaceSlug]/relationships/actions.ts` | `createWorkItemFromModal` | exported action |
| `app/[workspaceSlug]/relationships/actions.ts` | `createRelationshipAsset` | exported action |
| `app/[workspaceSlug]/relationships/actions.ts` | `createAssetFromModal` | exported action |
| `app/[workspaceSlug]/settings/actions.ts` | `saveWorkspaceOfficers` | exported action |
| `app/[workspaceSlug]/settings/actions.ts` | `updateWorkspaceName` | exported action |
| `app/[workspaceSlug]/settings/actions.ts` | `updateWorkspaceCoverLayout` | exported action |
| `app/[workspaceSlug]/settings/actions.ts` | `uploadWorkspaceBanner` | exported action |
| `app/[workspaceSlug]/settings/actions.ts` | `uploadWorkspaceLogo` | exported action |
| `app/[workspaceSlug]/settings/actions.ts` | `removeWorkspaceInvitation` | exported action |
| `app/[workspaceSlug]/settings/actions.ts` | `saveWorkspaceConnection` | exported action |
| `app/[workspaceSlug]/settings/actions.ts` | `verifyWorkspaceConnection` | exported action |
| `app/[workspaceSlug]/settings/actions.ts` | `diagnoseGoogleAdsOnboarding` | exported action |
| `app/[workspaceSlug]/settings/actions.ts` | `saveWhatsAppConfirmationTemplate` | exported action |
| `app/[workspaceSlug]/settings/actions.ts` | `stageManualWorkspaceConnection` | exported action |
| `app/[workspaceSlug]/settings/actions.ts` | `selectMetaAdsBusinessPortfolio` | exported action |
| `app/[workspaceSlug]/settings/actions.ts` | `completeWhatsAppEmbeddedSignup` | exported action |
| `app/[workspaceSlug]/settings/actions.ts` | `verifyPendingWorkspaceConnection` | exported action |
| `app/[workspaceSlug]/settings/actions.ts` | `discardPendingWorkspaceConnection` | exported action |
| `app/[workspaceSlug]/settings/actions.ts` | `rollbackWorkspaceConnection` | exported action |
| `app/[workspaceSlug]/settings/actions.ts` | `disconnectWorkspaceConnection` | exported action |
| `app/[workspaceSlug]/settings/actions.ts` | `saveWorkspaceOnboardingDomain` | exported action |
| `app/[workspaceSlug]/settings/actions.ts` | `saveWorkspaceClientPortalDomain` | exported action |
| `app/[workspaceSlug]/settings/actions.ts` | `verifyWorkspaceClientPortalDomain` | exported action |
| `app/[workspaceSlug]/settings/actions.ts` | `cancelWorkspaceClientPortalDomain` | exported action |
| `app/[workspaceSlug]/settings/actions.ts` | `verifyWorkspaceOnboardingDomain` | exported action |
| `app/[workspaceSlug]/settings/actions.ts` | `cancelWorkspaceOnboardingDomain` | exported action |
| `app/[workspaceSlug]/settings/branding-actions.ts` | `uploadAgencyLogo` | exported action |
| `app/[workspaceSlug]/settings/branding-actions.ts` | `uploadAgencyFavicon` | exported action |
| `app/[workspaceSlug]/settings/branding-actions.ts` | `saveAgencyPublicBranding` | exported action |
| `app/[workspaceSlug]/settings/branding-actions.ts` | `saveAgencyBranding` | exported action |
| `app/[workspaceSlug]/settings/onboarding-actions.ts` | `saveMandatoryModuleDraft` | exported action |
| `app/[workspaceSlug]/settings/onboarding-actions.ts` | `publishMandatoryModuleConfiguration` | exported action |
| `app/[workspaceSlug]/settings/onboarding-actions.ts` | `saveOnboardingHelpSettings` | exported action |
| `app/[workspaceSlug]/settings/service-actions.ts` | `saveOnboardingService` | exported action |
| `app/[workspaceSlug]/settings/service-actions.ts` | `saveOnboardingServiceStaffPermissions` | exported action |
| `app/[workspaceSlug]/settings/service-actions.ts` | `setOnboardingServiceState` | exported action |
| `app/[workspaceSlug]/settings/team-actions.ts` | `saveWorkspaceOperations` | exported action |
| `app/[workspaceSlug]/settings/team-actions.ts` | `saveServiceDeliveryUsers` | exported action |
| `app/[workspaceSlug]/settings/team-actions.ts` | `saveMaintenanceAssignments` | exported action |
| `app/[workspaceSlug]/users/actions.ts` | `inviteWorkspaceUser` | exported action |
| `app/[workspaceSlug]/users/actions.ts` | `removeWorkspaceUser` | exported action |
| `app/[workspaceSlug]/users/actions.ts` | `resetWorkspaceUserMfa` | exported action |
| `app/[workspaceSlug]/work-items/[id]/actions.ts` | `updateWorkItemSchedule` | exported action |
| `app/[workspaceSlug]/work-items/[id]/actions.ts` | `updateWorkItemDescription` | exported action |
| `app/[workspaceSlug]/work-items/[id]/actions.ts` | `updateWorkItemAssignees` | exported action |
| `app/[workspaceSlug]/work-items/[id]/actions.ts` | `updateWorkItemParent` | exported action |
| `app/[workspaceSlug]/work-items/[id]/actions.ts` | `updateWorkItemDependencies` | exported action |
| `app/[workspaceSlug]/work-items/[id]/actions.ts` | `updateWorkItemLinks` | exported action |
| `app/[workspaceSlug]/work-items/[id]/actions.ts` | `updateWorkItemPriority` | exported action |
| `app/[workspaceSlug]/work-items/[id]/actions.ts` | `completeAdminWorkItem` | exported action |
| `app/[workspaceSlug]/work-items/[id]/actions.ts` | `undoAdminWorkItemCompletion` | exported action |
| `app/onboarding/session/[token]/actions.ts` | `confirmDirectUploads` | exported action |
| `app/onboarding/session/[token]/actions.ts` | `completeStep` | exported action |
| `app/onboarding/session/[token]/actions.ts` | `completePreparedStep` | exported action |
| `app/onboarding/session/[token]/actions.ts` | `satisfyBlockRequirement` | exported action |
| `app/onboarding/session/[token]/actions.ts` | `configureAppointmentSettingBlock` | exported action |
| `app/onboarding/session/[token]/actions.ts` | `saveCalendarBlockResponse` | exported action |
| `app/onboarding/session/[token]/actions.ts` | `prepareDirectUploads` | exported action |
| `app/onboarding/session/[token]/actions.ts` | `submitPreparedFormStep` | exported action |
| `app/onboarding/session/[token]/actions.ts` | `saveStepDraft` | exported action |
| `app/onboarding/session/[token]/actions.ts` | `requestStepEdit` | exported action |
| `app/onboarding/session/[token]/actions.ts` | `markSessionNoticeSeen` | exported action |
| `app/onboarding/session/[token]/actions.ts` | `skipTestStep` | exported action |
| `app/onboarding/session/[token]/google-ads-actions.ts` | `getGoogleAdsOnboarding` | exported action |
| `app/onboarding/session/[token]/google-ads-actions.ts` | `connectOnboardingGoogleAds` | exported action |
| `app/onboarding/smsoptin/actions.ts` | `submitPublicSmsOptIn` | exported action |
| `app/users/[username]/actions.ts` | `updateProfile` | exported action |
| `app/users/[username]/actions.ts` | `createWorkspace` | exported action |
| `app/users/[username]/actions.ts` | `uploadProfileAvatar` | exported action |
| `app/users/[username]/actions.ts` | `deleteAccount` | exported action |
| `app/users/[username]/actions.ts` | `leaveWorkspace` | exported action |

## Migration completion recording

Record implementation and measured evidence in `docs/workspace-performance-revamp-plan.md` and the PR. Do not replace unresolved matrix rows with blanket certification. A route with an extracted client view still needs authorization, deep-link/history, view-state, pending-edit and meaningful-paint checks.
