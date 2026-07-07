import assert from "node:assert/strict"
import test from "node:test"

import {
    candidateLocationAppliesToState,
    candidatePrimaryCity,
    candidatePrimaryState,
    locationSignalsForCompany,
    sourceCoverageApplies,
} from "../lib/leadgen/location-resolution.ts"

test("uses the selected ICP location when a seed address is sparse", () => {
    const company = {
        address: {},
        location_value: "austin_tx",
        industry_value: "flooring_contractors",
    }

    assert.equal(candidatePrimaryState(company), "TX")
    assert.equal(candidatePrimaryCity(company), "Austin")
    assert.equal(candidateLocationAppliesToState(company, "TX"), true)
    assert.equal(sourceCoverageApplies({
        source_key: "registry.tx.comptroller",
        coverage: { states: ["TX"], industries: ["flooring_contractors"] },
    }, company), true)
    assert.equal(sourceCoverageApplies({
        source_key: "permits.tx.austin",
        coverage: { states: ["TX"], cities: ["Austin"], industries: ["flooring_contractors"] },
    }, company), true)
})

test("treats poll target geography as authoritative when seed address conflicts", () => {
    const company = {
        address: { city: "Los Angeles", state: "CA" },
        location_value: "austin_tx",
        industry_value: "general_contractors",
    }

    assert.equal(sourceCoverageApplies({
        source_key: "registry.tx.comptroller",
        coverage: { states: ["TX"] },
    }, company), true)
    assert.equal(sourceCoverageApplies({
        source_key: "registry.ca.bizfile",
        coverage: { states: ["CA"] },
    }, company), false)
})

test("expands metro targets to local source cities", () => {
    const dfwCompany = {
        address: null,
        location_value: "dfw_tx",
        industry_value: "general_contractors",
    }
    const houstonCompany = {
        address: null,
        location_value: "greater_houston_tx",
        industry_value: "roofers",
    }

    assert.equal(sourceCoverageApplies({
        source_key: "permits.tx.dallas",
        coverage: { states: ["TX"], cities: ["Dallas"] },
    }, dfwCompany), true)
    assert.equal(sourceCoverageApplies({
        source_key: "permits.tx.fort_worth",
        coverage: { states: ["TX"], cities: ["Fort Worth"] },
    }, dfwCompany), true)
    assert.equal(sourceCoverageApplies({
        source_key: "permits.tx.houston",
        coverage: { states: ["TX"], cities: ["Houston"] },
    }, houstonCompany), true)
    assert.equal(sourceCoverageApplies({
        source_key: "permits.tx.austin",
        coverage: { states: ["TX"], cities: ["Austin"] },
    }, houstonCompany), false)
})

test("maps city targets to county-level local sources", () => {
    assert.equal(sourceCoverageApplies({
        source_key: "registry.ca.los_angeles_fbn",
        coverage: { states: ["CA"], counties: ["Los Angeles"] },
    }, { address: null, location_value: "los_angeles_ca", industry_value: "auto_repair" }), true)
    assert.equal(sourceCoverageApplies({
        source_key: "registry.fl.miami_dade_lbt",
        coverage: { states: ["FL"], counties: ["Miami-Dade"] },
    }, { address: null, location_value: "miami_fl", industry_value: "cleaning_companies" }), true)
})

test("lets statewide all-industry registry sources run for any selected industry", () => {
    assert.equal(sourceCoverageApplies({
        source_key: "registry.fl.sunbiz",
        coverage: { states: ["FL"], industries: ["all_enabled"] },
    }, { address: null, location_value: "miami_fl", industry_value: "fencing_contractors" }), true)
    assert.equal(sourceCoverageApplies({
        source_key: "registry.fl.sunbiz",
        coverage: { states: ["FL"], industries: ["all_enabled"] },
    }, { address: null, location_value: "phoenix_az", industry_value: "fencing_contractors" }), false)
})

test("normalises state names and address freeform fields as a fallback", () => {
    const company = {
        address: {
            freeform: "123 S Lamar Blvd, Austin, Texas 78704",
        },
        location_value: null,
        industry_value: "plumbers",
    }
    const signals = locationSignalsForCompany(company)

    assert.equal(candidatePrimaryState(company), "TX")
    assert.equal(candidatePrimaryCity(company), "Austin")
    assert.equal(signals.postcode, "78704")
    assert.equal(sourceCoverageApplies({
        source_key: "state_license.tx.plumbing",
        coverage: { states: ["TX"], industries: ["plumbers"] },
    }, company), true)
})
