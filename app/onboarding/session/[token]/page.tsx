import { OnboardingSessionFlow } from "@/components/onboarding/OnboardingSessionFlow"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { getCanonicalSessionByToken, getCanonicalStepDraft, getFormResponseAsset } from "@/lib/onboarding/canonical"
import { getOnboardingForm, type FormResponse } from "@/lib/onboarding/forms"
import { OnboardingLayout } from "@/components/onboarding/OnboardingLayout"
import { OnboardingSessionRenderer } from "@/components/onboarding/OnboardingSessionRenderer"
import { headers } from "next/headers"
import { OnboardingThemeProvider } from "@/components/onboarding/OnboardingThemeProvider"
import { createPrivateUploadSignedUrl } from "@/lib/onboarding/uploads"
import { getFrozenOnboardingPaymentDefinition, getOnboardingPaymentContext, onboardingPaymentPending } from "@/lib/client-sales/onboarding-checkout"
import { ONBOARDING_PAYMENT_BUTTON_ID, stepEstimate, stepHeader } from "@/lib/onboarding/block-definition"
import { getClientPortalUrlForOnboardingSession } from "@/lib/client-portal/session"
import { redirect } from "next/navigation"
import type { Metadata } from "next"
import { clientFaviconIcons } from "@/lib/client-branding/favicon"
import { agencyBrandedMetadata, currentPublicPageUrl, loadClientPagePublicBranding, loadWorkspacePublicBranding } from "@/lib/client-branding/public-branding"
import { clientBrandLogoUrl, loadWorkspaceClientBrandAssets } from "@/lib/client-branding/assets"

export const dynamic = "force-dynamic"

type PageProps = {
    params: Promise<{ token: string }>
    searchParams: Promise<{ step?: string; payment?: string; reason?: string; meta?: string; connection_reason?: string }>
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
    const { token } = await params
    const [branding, icons, canonicalUrl] = await Promise.all([
        loadClientPagePublicBranding("onboarding", token),
        clientFaviconIcons("onboarding", token),
        currentPublicPageUrl(),
    ])
    return {
        ...agencyBrandedMetadata(branding, "onboarding", canonicalUrl),
        robots: { index: false, follow: false },
        icons,
    }
}

export default async function CanonicalSessionPage({ params, searchParams }: PageProps) {
    const { token } = await params
    const { step: requestedStepKey, payment: paymentResult, reason: paymentReason, meta: metaResult, connection_reason: connectionReason } = await searchParams
    const requestHeaders = await headers()
    const customOnboardingDomain = requestHeaders.get("x-betelgeze-custom-onboarding-domain")
    const resolved = await getCanonicalSessionByToken(token)

    if (!resolved) {
        return (
            <main data-betelgeze-onboarding-session="invalid" className="flex min-h-screen items-center justify-center bg-[#F8F7F3] px-6 text-slate-900">
                <p>Invalid onboarding link.</p>
            </main>
        )
    }

    const { session, workspace, relationship, steps, completableSteps, completedKeys, moduleTitles, theme, help, notices, satisfiedBlockIds, blockResponses } = resolved
    const [publicBranding, brandAssets] = await Promise.all([
        loadWorkspacePublicBranding(workspace.id, workspace.name),
        loadWorkspaceClientBrandAssets(workspace.id),
    ])
    const logoSrc = clientBrandLogoUrl("onboarding", token, brandAssets.logoPath)
    if (session.status === "completed") {
        const clientPortalUrl = await getClientPortalUrlForOnboardingSession({
            workspaceId: session.workspace_id,
            relationshipId: session.relationship_id,
        })
        if (clientPortalUrl) redirect(clientPortalUrl)
    }
    const paymentContext = await getOnboardingPaymentContext(token)
    if (onboardingPaymentPending(paymentContext) && paymentContext) {
        const paymentDefinition = await getFrozenOnboardingPaymentDefinition(paymentContext)
        const paymentStep = paymentDefinition.steps[0]
        const header = stepHeader(paymentStep)
        const resolvedBlocks = await Promise.all(paymentStep.blocks.map(async (block) => {
            if (block.kind === "video" && block.upload?.path) return { ...block, upload: { ...block.upload, resolvedUrl: await createPrivateUploadSignedUrl(block.upload.path) } }
            if (block.id === ONBOARDING_PAYMENT_BUTTON_ID && block.kind === "button") return { ...block, url: `/api/onboarding/session/${token}/checkout`, required: true, openInSameTab: true }
            return block
        }))
        const roadmapSteps = [
            { key: "payment", title: "Payment", complete: false, current: true, href: null },
            ...steps.map((step) => ({ key: step.key, title: step.title, complete: false, current: false, href: null })),
        ]
        return <OnboardingThemeProvider theme={theme}><OnboardingLayout clientSession roadmapSteps={roadmapSteps} client={{ name: relationship.primary_person_name, email: relationship.primary_email, phone: relationship.primary_phone, isTest: session.is_test }} workspaceName={publicBranding.displayName} logoSrc={logoSrc} help={help} privacyPolicyUrl={publicBranding.privacyPolicyUrl} termsOfServiceUrl={publicBranding.termsOfServiceUrl}>
            <OnboardingSessionRenderer
                step={{ key: "payment", kind: "video", title: header.title, description: header.description, moduleTitle: "Payment", estimatedTime: stepEstimate(paymentStep)?.estimatedTime ?? header.estimatedTime, why: "", blocks: resolvedBlocks, navigation: paymentStep.navigation }}
                moduleTitles={moduleTitles}
                token={token}
                locked={false}
                preview={false}
                allowEditRequest={false}
                satisfiedBlockIds={[]}
                notice={paymentResult === "pending" ? <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">Stripe is still confirming the payment. This page will unlock as soon as payment succeeds.</div> : paymentResult === "unavailable" ? <div className="mt-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">{paymentReason || "Payment could not be opened. Please try again or contact the team for help."}</div> : null}
            />
        </OnboardingLayout></OnboardingThemeProvider>
    }
    const linearCurrentStep = completableSteps.find((step) => !completedKeys.has(step.key)) ?? steps[steps.length - 1]
    const requestedCandidate = steps.find((step) => step.key === requestedStepKey)
    const requestedStep = requestedCandidate && (session.status === "completed" || completedKeys.has(requestedCandidate.key) || requestedCandidate.key === linearCurrentStep.key)
        ? requestedCandidate
        : null
    const currentStep = requestedStep ?? linearCurrentStep
    const [submittedResponse, draft, drafts, preparedSteps] = await Promise.all([
        currentStep.kind === "form" ? getFormResponseAsset(session.id, currentStep) : undefined,
        currentStep.kind === "form" ? getCanonicalStepDraft(token, currentStep.key, resolved) : null,
        supabaseAdmin.from("onboarding_step_drafts").select("session_step_id, response")
            .eq("workspace_id", session.workspace_id).eq("session_id", session.id),
        Promise.all(steps.map(async (step) => ({
            ...step,
            form: step.kind === "form" ? step.form ?? getOnboardingForm(step.formKey) : null,
            videoUrl: step.videoPath ? await createPrivateUploadSignedUrl(step.videoPath) : step.videoUrl,
            blocks: await Promise.all((step.blocks ?? []).map(async (block) => block.kind === "video" && block.upload?.path
                ? { ...block, upload: { ...block.upload, resolvedUrl: await createPrivateUploadSignedUrl(block.upload.path) } }
                : block)),
        }))),
    ])
    const initialResponse = submittedResponse ?? draft?.response
    const initialResponses = Object.fromEntries((drafts.data ?? []).map((row) => [row.session_step_id, row.response as FormResponse]))
    if (initialResponse) initialResponses[currentStep.key] = initialResponse
    // Dynamic server request: timestamp the freshly signed media URLs.
    // eslint-disable-next-line react-hooks/purity
    const preparedAt = Date.now()
    return <OnboardingSessionFlow
        key={`${session.id}:${session.composition_hash}:${currentStep.key}`}
        token={token} steps={preparedSteps} initialStepKey={currentStep.key}
        completableStepKeys={completableSteps.map((step) => step.key)} initialCompletedKeys={[...completedKeys]}
        initialResponses={initialResponses} compositionHash={session.composition_hash ?? null} preparedAt={preparedAt}
        sessionStatus={session.status} isTest={session.is_test}
        moduleTitles={moduleTitles} theme={theme} help={help} notices={notices}
        satisfiedBlockIds={[...satisfiedBlockIds]} blockResponses={blockResponses}
        client={{ name: relationship.primary_person_name, email: relationship.primary_email, phone: relationship.primary_phone }}
        workspaceName={publicBranding.displayName} logoSrc={logoSrc}
        privacyPolicyUrl={publicBranding.privacyPolicyUrl} termsOfServiceUrl={publicBranding.termsOfServiceUrl}
        basePath={customOnboardingDomain ? `/${token}` : `/onboarding/session/${token}`}
        paymentComplete={Boolean(paymentContext)} metaResult={metaResult} connectionReason={connectionReason}
    />
}
