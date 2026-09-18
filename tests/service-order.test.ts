import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { validServiceOrder } from "../lib/onboarding/service-order.ts"

const catalogue = readFileSync("components/settings/ServiceCatalogue.tsx", "utf8")
const route = readFileSync("app/api/workspaces/[workspaceSlug]/services/order/route.ts", "utf8")

test("service ordering accepts PostgreSQL UUIDs with deterministic legacy bits", () => {
    assert.equal(validServiceOrder([
        "93293d9c-a23c-3ab4-0b27-46931ddca1d8",
        "4ff0f82d-1d63-4771-13f9-42b25531de9e",
        "693d7b07-4f17-0d87-46f8-bd73d750adc3",
    ]), true)
    assert.equal(validServiceOrder([
        "93293d9c-a23c-3ab4-0b27-46931ddca1d8",
        "93293d9c-a23c-3ab4-0b27-46931ddca1d8",
    ]), false)
    assert.equal(validServiceOrder(["not-a-uuid"]), false)
})

test("service order autosaves through a background command with animated local feedback", () => {
    assert.match(catalogue, /sendServiceOrder\(workspaceSlug, next\)/)
    assert.doesNotMatch(catalogue, /reorderOnboardingServices\(workspaceSlug, next\)/)
    assert.match(catalogue, /data-workspace-autosave="true"/)
    assert.match(catalogue, /row\.animate\(/)
    assert.match(catalogue, /translate3d/)
    assert.match(catalogue, /dragPreviewRef/)
    assert.match(catalogue, /captureTarget\.setPointerCapture\(pointerId\)/)
    assert.match(catalogue, /host\.addEventListener\("pointerup", up\)/)
    assert.match(catalogue, /captureTarget\.addEventListener\("lostpointercapture", abort\)/)
    assert.match(catalogue, /host\.addEventListener\("blur", abort\)/)
    assert.doesNotMatch(catalogue, /onPointerMove=/)
    assert.match(route, /requireWorkspace\(workspaceSlug, "admin"\)/)
    assert.match(route, /configurationRpc<ReorderedServices>\("reorder_onboarding_services"/)
    assert.match(route, /Invalid save origin/)
    assert.doesNotMatch(route, /revalidateOnboardingConfiguration/)
})
