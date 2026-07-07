export type OwnerIdentityCoverageLocation = {
    value: string
    label: string
    state: "TX" | "FL" | "CA" | "AZ"
}

export const selectableOwnerIdentityIndustries = [
    "auto_repair",
    "bathroom_remodelling",
    "cleaning_companies",
    "concrete_contractors",
    "deck_builders",
    "dental_practices",
    "dumpster_rental",
    "electricians",
    "excavation_contractors",
    "fencing_contractors",
    "flooring_contractors",
    "freight_forwarders",
    "garage_door_companies",
    "general_contractors",
    "hardscaping_contractors",
    "hauling_services",
    "healthcare_providers",
    "home_builders",
    "hvac_contractors",
    "insulation_contractors",
    "kitchen_remodelling",
    "landscapers",
    "lawn_care_companies",
    "lighting_contractors",
    "masonry_contractors",
    "medical_clinics",
    "moving_companies",
    "painters",
    "patio_contractors",
    "paving_contractors",
    "pest_control",
    "plumbers",
    "pool_builders",
    "remodellers",
    "restoration_companies",
    "roofers",
    "siding_contractors",
    "solar_installers",
    "therapy_practices",
    "tree_services",
    "trucking_companies",
    "waste_disposal",
    "water_damage_restoration",
    "water_well_services",
    "window_and_door_contractors",
] as const

export const selectableOwnerIdentityLocations: OwnerIdentityCoverageLocation[] = [
    { value: "arizona", label: "Arizona", state: "AZ" },
    { value: "austin_tx", label: "Austin, TX", state: "TX" },
    { value: "bay_area_ca", label: "Bay Area, CA", state: "CA" },
    { value: "california", label: "California", state: "CA" },
    { value: "dallas_tx", label: "Dallas, TX", state: "TX" },
    { value: "dfw_tx", label: "Dallas-Fort Worth, TX", state: "TX" },
    { value: "florida", label: "Florida", state: "FL" },
    { value: "fort_worth_tx", label: "Fort Worth, TX", state: "TX" },
    { value: "greater_houston_tx", label: "Greater Houston, TX", state: "TX" },
    { value: "houston_tx", label: "Houston, TX", state: "TX" },
    { value: "jacksonville_fl", label: "Jacksonville, FL", state: "FL" },
    { value: "los_angeles_ca", label: "Los Angeles, CA", state: "CA" },
    { value: "miami_fl", label: "Miami, FL", state: "FL" },
    { value: "orlando_fl", label: "Orlando, FL", state: "FL" },
    { value: "phoenix_az", label: "Phoenix, AZ", state: "AZ" },
    { value: "san_antonio_tx", label: "San Antonio, TX", state: "TX" },
    { value: "san_diego_ca", label: "San Diego, CA", state: "CA" },
    { value: "tampa_fl", label: "Tampa, FL", state: "FL" },
    { value: "texas", label: "Texas", state: "TX" },
    { value: "tucson_az", label: "Tucson, AZ", state: "AZ" },
]

export const pass1CoreOwnerIdentitySourcesByState: Record<OwnerIdentityCoverageLocation["state"], string[]> = {
    TX: ["registry.tx.comptroller"],
    FL: ["registry.fl.sunbiz", "registry.fl.fictitious_names"],
    CA: ["registry.ca.los_angeles_fbn", "registry.ca.san_francisco_business_locations", "registry.ca.san_diego_business_tax"],
    AZ: ["registry.az.corp_commission"],
}

export const pass2TransportOwnerIdentityIndustries = [
    "dumpster_rental",
    "freight_forwarders",
    "hauling_services",
    "moving_companies",
    "trucking_companies",
    "waste_disposal",
] as const

export const pass2NationalOwnerIdentitySources = ["transport.fmcsa_census"] as const

export const pass3BayAreaOwnerIdentitySources = ["registry.ca.san_francisco_business_locations"] as const

export const pass3LocalOwnerIdentitySourcesByLocation: Record<string, readonly string[]> = {
    bay_area_ca: pass3BayAreaOwnerIdentitySources,
}

export const pass5CaliforniaLocalOwnerIdentitySourcesByLocation: Record<string, readonly string[]> = {
    california: ["registry.ca.los_angeles_fbn", "registry.ca.san_francisco_business_locations", "registry.ca.san_diego_business_tax"],
    los_angeles_ca: ["registry.ca.los_angeles_fbn"],
    san_diego_ca: ["registry.ca.los_angeles_fbn", "registry.ca.san_francisco_business_locations", "registry.ca.san_diego_business_tax"],
    bay_area_ca: ["registry.ca.san_francisco_business_locations"],
}

export const pass5CaliforniaWasteOwnerIdentitySources = ["regulated.ca.calrecycle_waste"] as const

export function pass1OwnerIdentitySourcesForCombo(industryValue: string, locationValue: string) {
    if (!selectableOwnerIdentityIndustries.includes(industryValue as (typeof selectableOwnerIdentityIndustries)[number])) return []
    const location = selectableOwnerIdentityLocations.find((item) => item.value === locationValue)
    if (!location) return []
    return pass1CoreOwnerIdentitySourcesByState[location.state]
}

export function pass2OwnerIdentitySourcesForCombo(industryValue: string, locationValue: string) {
    const pass1Sources = pass1OwnerIdentitySourcesForCombo(industryValue, locationValue)
    const hasLocation = selectableOwnerIdentityLocations.some((item) => item.value === locationValue)
    const transportSources = hasLocation && pass2TransportOwnerIdentityIndustries.includes(industryValue as (typeof pass2TransportOwnerIdentityIndustries)[number])
        ? [...pass2NationalOwnerIdentitySources]
        : []
    return [...new Set([...pass1Sources, ...transportSources])]
}

export function pass3OwnerIdentitySourcesForCombo(industryValue: string, locationValue: string) {
    const pass2Sources = pass2OwnerIdentitySourcesForCombo(industryValue, locationValue)
    const hasIndustry = selectableOwnerIdentityIndustries.includes(industryValue as (typeof selectableOwnerIdentityIndustries)[number])
    const localSources = hasIndustry ? pass3LocalOwnerIdentitySourcesByLocation[locationValue] ?? [] : []
    return [...new Set([...pass2Sources, ...localSources])]
}

export function pass5OwnerIdentitySourcesForCombo(industryValue: string, locationValue: string) {
    const pass3Sources = pass3OwnerIdentitySourcesForCombo(industryValue, locationValue)
    const location = selectableOwnerIdentityLocations.find((item) => item.value === locationValue)
    if (location?.state !== "CA") return pass3Sources
    const localSources = pass5CaliforniaLocalOwnerIdentitySourcesByLocation[locationValue] ?? []
    const wasteSources = industryValue === "waste_disposal" ? pass5CaliforniaWasteOwnerIdentitySources : []
    return [...new Set([...pass3Sources, ...localSources, ...wasteSources])]
}

export function pass1OwnerIdentityCoverageGaps() {
    const gaps: Array<{ industry: string; location: string }> = []
    for (const industry of selectableOwnerIdentityIndustries) {
        for (const location of selectableOwnerIdentityLocations) {
            const sources = pass1OwnerIdentitySourcesForCombo(industry, location.value)
            if (sources.length === 0 || sources.includes("website")) gaps.push({ industry, location: location.value })
        }
    }
    return gaps
}
