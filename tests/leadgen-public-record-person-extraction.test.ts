import assert from "node:assert/strict"
import test from "node:test"

import {
    bestPublicRecordPerson,
    isLikelyPublicRecordPersonName,
    normalisePublicRecordPersonName,
    publicRecordPersonCandidates,
} from "../lib/leadgen/public-record-person-extraction.ts"

test("extracts configured officer and registered-agent fields from official rows", () => {
    const candidate = bestPublicRecordPerson({
        name: "JJS Home Services LLC",
        officer_name: "Maria Alvarez",
        officer_title: "Managing Member",
        registered_agent_name: "Capitol Registered Agents LLC",
    }, {
        person_role: "registered_agent_or_pir_officer",
        field_map: { owner_name: ["officer_name", "registered_agent_name"] },
    })

    assert.ok(candidate)
    assert.equal(candidate.name, "Maria Alvarez")
    assert.equal(candidate.role, "registered_agent_or_pir_officer")
    assert.equal(candidate.sourceField, "officer_name")
})

test("normalises comma-reversed public-record names and strips role suffixes", () => {
    assert.equal(normalisePublicRecordPersonName("SMITH, JOHN A - MANAGER"), "John A Smith")
    assert.equal(normalisePublicRecordPersonName("Qualifying Individual: MARIA DELGADO"), "Maria Delgado")
    assert.equal(isLikelyPublicRecordPersonName("SMITH, JOHN A - MANAGER"), true)
})

test("normalises all-caps surname-first public-record names when given name evidence is strong", () => {
    assert.equal(normalisePublicRecordPersonName("SENOR MIRIAM"), "Miriam Senor")
    assert.equal(normalisePublicRecordPersonName("DE LA CRUZ MARIA"), "Maria de la Cruz")
})

test("uses fast frequency scoring to resolve probable surname-first public-record names", () => {
    assert.equal(normalisePublicRecordPersonName("Williams Robert"), "Robert Williams")
    assert.equal(normalisePublicRecordPersonName("SALAS JUAN"), "Juan Salas")
    assert.equal(normalisePublicRecordPersonName("Martins Charles"), "Charles Martins")
    assert.equal(normalisePublicRecordPersonName("Rudnitsky Aleksandr"), "Aleksandr Rudnitsky")
    assert.equal(normalisePublicRecordPersonName("Blandford Jason"), "Jason Blandford")
    assert.equal(normalisePublicRecordPersonName("Bunch Susan"), "Susan Bunch")
    assert.equal(normalisePublicRecordPersonName("Robert Williams"), "Robert Williams")
    assert.equal(normalisePublicRecordPersonName("David Collins"), "David Collins")
    assert.equal(normalisePublicRecordPersonName("Susan Bunch"), "Susan Bunch")
    assert.equal(normalisePublicRecordPersonName("Juan Carlos Salas Garcia"), "Juan Carlos Salas Garcia")
})

test("builds a person from first middle last fragments", () => {
    const candidate = bestPublicRecordPerson({
        principal_first_name: "Ana",
        principal_middle_name: "R",
        principal_last_name: "Lopez",
    })

    assert.ok(candidate)
    assert.equal(candidate.name, "Ana R Lopez")
    assert.equal(candidate.role, "license_principal")
    assert.equal(candidate.sourceField, "principal_first_middle_last")
})

test("prefers high-confidence license principals over generic contacts", () => {
    const candidates = publicRecordPersonCandidates({
        Point_of_Contact: "Sam Rivera",
        RESPONSIBLE_APPLICATOR: "Priya Shah",
        business_name: "Austin Pest Pros LLC",
    })

    assert.equal(candidates[0]?.name, "Priya Shah")
    assert.equal(candidates[0]?.role, "license_principal")
    assert.ok((candidates[0]?.confidence ?? 0) > (candidates.find((candidate) => candidate.name === "Sam Rivera")?.confidence ?? 0))
})

test("supports ArcGIS-style registered owner and point-of-contact field names", () => {
    assert.equal(bestPublicRecordPerson({ RegisteredOwnerName: "LEE, DANIEL" })?.name, "Daniel Lee")
    assert.equal(bestPublicRecordPerson({ Point_of_Contact: "Nora Patel" })?.name, "Nora Patel")
})

test("does not treat property owners or business names as lead-owner identities", () => {
    assert.equal(bestPublicRecordPerson({
        property_owner_name: "Robert Customer",
        business_name: "Austin Flooring Pros LLC",
    }), null)
    assert.equal(isLikelyPublicRecordPersonName("Austin Flooring Pros LLC"), false)
    assert.equal(isLikelyPublicRecordPersonName("Capitol Registered Agents LLC"), false)
    assert.equal(isLikelyPublicRecordPersonName("de la"), false)
})
