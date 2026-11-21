import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const directDetailPages = [
    "components/workspace/NativeRelationshipsPanel.tsx",
    "app/[workspaceSlug]/onboarding/[relationshipId]/page.tsx",
    "app/[workspaceSlug]/work/[relationshipId]/page.tsx",
    "app/[workspaceSlug]/work-items/[id]/page.tsx",
    "app/[workspaceSlug]/assets/[id]/page.tsx",
    "app/[workspaceSlug]/admin/activity/[eventId]/page.tsx",
]

test("retired Lead Gen poll details retain shared read-only identity and fields", async () => {
    const source = await readFile("app/[workspaceSlug]/leadgen/poll/[pollId]/page.tsx", "utf8")
    assert.match(source, /<DetailPageHeader/)
    assert.match(source, /<DetailFields>/)
    assert.doesNotMatch(source, /<DetailDangerZone|<DetailDangerAction/, "historical polls cannot be deleted")
})

test("saved Lead Gen company details retain shared read-only identity and fields", async () => {
    const source = await readFile("app/[workspaceSlug]/leadgen/company/[companyId]/page.tsx", "utf8")
    assert.match(source, /<DetailPageHeader/)
    assert.match(source, /<DetailFields>/)
    assert.doesNotMatch(source, /<DetailDangerZone|<DetailDangerAction/)
})

test("record detail routes use the shared detail header and danger-zone anatomy", async () => {
    const pages = await Promise.all(directDetailPages.map(async (path) => ({ path, source: await readFile(path, "utf8") })))

    for (const page of pages) {
        assert.match(page.source, /<DetailPageHeader/, `${page.path} must use DetailPageHeader`)
        assert.match(page.source, /<DetailDangerZone|<OnboardingDangerZone/, `${page.path} must end with the shared danger-zone treatment`)
        assert.doesNotMatch(page.source, /Danger zone placeholder/, `${page.path} must not show a page-local danger placeholder`)
    }
})

test("detail field implementations use the shared borderless field rows", async () => {
    const sharedFields = await readFile("components/detail/DetailFields.tsx", "utf8")
    const relationshipFields = await readFile("app/[workspaceSlug]/relationships/[relationshipId]/RelationshipDealWorkspace.tsx", "utf8")
    const workItemFields = await readFile("app/[workspaceSlug]/work-items/[id]/InlineWorkItemFields.tsx", "utf8")

    assert.match(sharedFields, /columns = 2/)
    assert.match(sharedFields, /group\/fields grid grid-cols-1 /)
    assert.match(sharedFields, /`mt-5 \$\{columns === 2 \? "lg:grid-cols-2" : ""\}`/)
    assert.match(sharedFields, /min-h-9 [^`]*gap-2 py-1\.5 /, "workspace rows are plain: no divider")
    assert.match(sharedFields, /group-data-\[surface=light\]\/fields:border-b group-data-\[surface=light\]\/fields:border-black\/10/, "light client-facing rows keep theirs")
    assert.doesNotMatch(sharedFields, /rounded-[^\s"]+ border/)
    assert.match(relationshipFields, /<DetailFields>/)
    assert.match(workItemFields, /<DetailFields>/)
})

test("relationship fields use semantic icons and shared auto-growing notes", async () => {
    const icons = await readFile("components/detail/DetailFields.tsx", "utf8")
    const relationship = await readFile("components/relationships/RelationshipBackgroundEditor.tsx", "utf8")
    const textarea = await readFile("components/ui/AutoGrowTextarea.tsx", "utf8")

    assert.match(icons, /company:/)
    assert.match(icons, /role:/)
    assert.match(icons, /location:/)
    assert.match(relationship, /\["locationValue", "Location", "location"/)
    assert.match(relationship, /<AutoGrowTextarea aria-label="Relationship notes"/)
    assert.match(textarea, /resize-none overflow-hidden/)
    assert.match(textarea, /textarea\.scrollHeight/)
    assert.match(textarea, /closest\("dialog"\)/)
    assert.match(textarea, /MutationObserver/)
    assert.doesNotMatch(textarea, /field-sizing:content/, "native content sizing must not compete with measured textarea height")
})

test("detail headers omit operational status and allow at most two unrepeated facts", async () => {
    const header = await readFile("components/detail/DetailPageHeader.tsx", "utf8")
    const onboarding = await readFile("app/[workspaceSlug]/onboarding/[relationshipId]/page.tsx", "utf8")

    assert.doesNotMatch(header, /status\??:/)
    assert.match(header, /readonly \[DetailHeaderFact, DetailHeaderFact\]/)
    assert.match(onboarding, /<SquarePill tone="yellow">Test<\/SquarePill>/)
    assert.match(onboarding, /<SquarePill tone="red">Stuck<\/SquarePill>/)
    assert.equal(onboarding.match(/<Status /g)?.length, 1, "onboarding must render its overall status only in the Status field")
})

test("the detail danger zone preserves archive-before-delete ordering and visual tones", async () => {
    const source = await readFile("components/detail/DetailDangerZone.tsx", "utf8")

    assert.match(source, /<section className="mt-12 border-t border-card-border pt-5">/, "a hairline and a small red heading, not a red box")
    assert.match(source, /<h2 className="text-xs font-medium text-red-300">Danger zone<\/h2>/)
    assert.match(source, /divide-y divide-card-border/)
    assert.match(source, /tone === "delete"/)
    assert.match(source, /border-red-800\/80 bg-red-950\/40/, "delete stays the stronger of the two red buttons")
    assert.match(source, /: "border border-red-900\/80 text-red-200 hover:bg-red-950\/40"/, "archive stays the quieter outline")
})
