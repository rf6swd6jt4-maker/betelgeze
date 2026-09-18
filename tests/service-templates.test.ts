import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import test from "node:test"
import { SERVICE_TEMPLATES, serviceTemplateThumbnailSrc, serviceTemplateThumbnailSrcFromDefinition } from "../lib/onboarding/service-templates.ts"

const servicesUi = readFileSync("components/settings/ServiceCatalogue.tsx", "utf8")
const relationshipThumbnail = readFileSync("components/relationships/ServiceThumbnail.tsx", "utf8")
const thumbnailResolver = readFileSync("lib/onboarding/service-thumbnail.ts", "utf8")
const checkout = readFileSync("lib/client-sales/onboarding-checkout.ts", "utf8")
const thumbnailMigration = readFileSync("supabase/migrations/20260918090000_template_service_thumbnails.sql", "utf8")
const reorderMigration = readFileSync("supabase/migrations/20260918120000_reorder_onboarding_services.sql", "utf8")

test("the service template catalogue starts with the Meta Ads template", () => {
    assert.equal(SERVICE_TEMPLATES.length, 4)
    const [metaAds, appointmentSetting] = SERVICE_TEMPLATES
    assert.equal(metaAds.id, "meta-ads")
    assert.equal(metaAds.name, "Meta Ads")
    assert.ok(metaAds.description.length > 0)
    assert.equal(metaAds.serviceDefaults.thumbnailSrc, metaAds.thumbnail.src)
    assert.deepEqual(metaAds.setup, { kind: "connection", connectionKey: "windsor" })
    assert.deepEqual(metaAds.capabilities, ["onboarding.manage", "fulfilment.manage"])
    assert.deepEqual(metaAds.onboardingBlocks, [{ kind: "connection", label: "Meta Ads reporting connection" }])
    assert.equal(existsSync(`public${metaAds.thumbnail.src}`), true)
    assert.equal(appointmentSetting.id, "appointment-setting")
    assert.equal(appointmentSetting.name, "Appointment Setting")
    assert.equal(appointmentSetting.thumbnail.src, "/service-templates/appointment-setting.png")
    assert.equal(appointmentSetting.serviceDefaults.thumbnailSrc, appointmentSetting.thumbnail.src)
    assert.deepEqual(appointmentSetting.setup, { kind: "none" })
    assert.deepEqual(appointmentSetting.capabilities, ["onboarding.manage", "fulfilment.manage", "appointment_setting.manage"])
    assert.deepEqual(appointmentSetting.onboardingBlocks.map((block) => block.kind), ["appointment_medium", "appointment_fields"])
    assert.equal(existsSync(`public${appointmentSetting.thumbnail.src}`), true)
})

test("Search and Local Services Ads share the trusted Google connection process", () => {
    const googleServices = SERVICE_TEMPLATES.filter((template) => template.setup.kind === "connection" && template.setup.connectionKey === "google_ads")
    assert.deepEqual(googleServices.map((template) => [template.id, template.name]), [
        ["google-search-ads", "Google Search Ads"],
        ["google-local-services-ads", "Google Local Services Ads"],
    ])
    for (const service of googleServices) {
        assert.deepEqual(service.onboardingBlocks, [{ kind: "google_ads_connection", label: "Google Ads connection" }])
        assert.equal(existsSync(`public${service.thumbnail.src}`), true)
    }
})

test("template covers persist until an uploaded thumbnail replaces them", () => {
    for (const template of SERVICE_TEMPLATES) {
        assert.equal(serviceTemplateThumbnailSrc(template.id), template.thumbnail.src)
    }
    assert.equal(serviceTemplateThumbnailSrc("unknown"), null)
    assert.equal(serviceTemplateThumbnailSrcFromDefinition({ templateId: "meta-ads" }), "/service-templates/meta-ads.png")
    assert.equal(serviceTemplateThumbnailSrcFromDefinition({ template_id: "appointment-setting" }), "/service-templates/appointment-setting.png")
    assert.equal(serviceTemplateThumbnailSrcFromDefinition({ templateId: "meta-ads", thumbnailTemplateId: null }), null)
    assert.equal(serviceTemplateThumbnailSrcFromDefinition({ templateId: "meta-ads", thumbnailTemplateId: "appointment-setting" }), "/service-templates/appointment-setting.png")
    assert.match(thumbnailMigration, /thumbnailTemplateId/)
    assert.match(thumbnailMigration, /definition->>'thumbnailPath'/)
    assert.match(relationshipThumbnail, /const source = service\.thumbnailUrl/)
    assert.doesNotMatch(relationshipThumbnail, /SERVICE_TEMPLATES/)
    assert.match(thumbnailResolver, /serviceTemplateThumbnailSrcFromDefinition/)
    assert.match(thumbnailResolver, /new URL\(source, origin\)/)
    assert.match(checkout, /frozenCheckoutLineItems\(context, expiresAt, input\.origin\)/)
})

test("the onboarding builder offers one shared connection block for both Google Ads services", () => {
    const builder = readFileSync("components/onboarding-builder/OnboardingBuilderWorkspace.tsx", "utf8")
    assert.match(builder, /const installedConnectionGroups = new Set<string>\(\)/)
    assert.match(builder, /`connection:\$\{template\.setup\.connectionKey\}`/)
    assert.match(builder, /if \(installedConnectionGroups\.has\(group\)\) return false/)
})

test("New service opens templates and the first card reaches the preserved custom editor", () => {
    assert.match(servicesUi, />Service Templates</)
    assert.match(servicesUi, />Add your own</)
    assert.match(servicesUi, />Create a custom service from scratch\.</)
    assert.match(servicesUi, /SERVICE_TEMPLATES\.map/)
    assert.match(servicesUi, /onSelectTemplate\(template\)/)
    assert.match(servicesUi, /onClick=\{\(\) => setTemplatesOpen\(true\)\}/)
    assert.doesNotMatch(servicesUi, /onClick=\{\(\) => setSelectedId\("new"\)\}/)
    assert.match(servicesUi, /onCreateCustom=\{\(\) => \{ setTemplatesOpen\(false\); setSelectedId\("new"\) \}\}/)
    assert.match(servicesUi, /initialServiceId && initialServiceId !== "new"/)
    assert.match(servicesUi, /selectedId === "new" \? blankService\(\)/)
    assert.match(servicesUi, /blankService\(selectedTemplate\)/)
    assert.match(servicesUi, /"Create service"/)
})

test("Services uses a compact Settings option list with popup editing", () => {
    assert.match(servicesUi, /<ServiceStatusSummary services=\{services\}/)
    assert.match(servicesUi, /label="Active" tone="green"/)
    assert.match(servicesUi, /label="Retired" tone="yellow"/)
    assert.match(servicesUi, /label="Archived" tone="grey"/)
    assert.match(servicesUi, /role="list" aria-label="Services"/)
    assert.match(servicesUi, /role="listitem" data-service-id=\{service\.id\}/)
    assert.match(servicesUi, /service\.thumbnailUrl \? <Image/)
    assert.match(servicesUi, /title="Drag to reorder"/)
    assert.match(servicesUi, /sendServiceOrder\(workspaceSlug, next\)/)
    assert.match(servicesUi, /Drag services to change the order in which they appear in onboarding\./)
    assert.doesNotMatch(servicesUi, />Display priority</)
    assert.match(reorderMigration, /create or replace function public\.reorder_onboarding_services/)
    assert.match(reorderMigration, /perform public\.require_onboarding_admin_actor/)
    assert.match(reorderMigration, /revision\.revision_number desc/)
    assert.match(reorderMigration, /set display_priority = v_service_count - requested\.ordinality \+ 1/)
    assert.match(reorderMigration, /grant execute on function public\.reorder_onboarding_services\(uuid, uuid, uuid\[\]\) to service_role/)
    assert.match(servicesUi, /onClick=\{\(\) => setSelectedId\(service\.id\)\}/)
    assert.match(servicesUi, /aria-label=\{`Edit \$\{service\.name\}`\}/)
    assert.match(servicesUi, /createPortal\(<ServiceEditor/)
    assert.match(servicesUi, /fixed inset-0[\s\S]*items-center justify-center/)
    assert.doesNotMatch(servicesUi, /settings\/services\/\$\{encodeURIComponent\(service\.id\)\}/)
    assert.doesNotMatch(servicesUi, /<List|<MobileListActionSurface|<ListActionMenu/)
})

test("service settings keep fulfilment eligibility without editable panel permissions", () => {
    const teamUi = readFileSync("components/settings/WorkspaceTeamSettings.tsx", "utf8")
    assert.match(servicesUi, /DeliveryUserPicker/)
    assert.match(teamUi, /No service eligibility selected/)
    assert.doesNotMatch(teamUi, /Service fulfilment permissions|Edit permissions/)
    assert.doesNotMatch(servicesUi, /STAFF_SERVICE_PERMISSION_OPTIONS|saveOnboardingServiceStaffPermissions|Fulfilment permissions/)
})
