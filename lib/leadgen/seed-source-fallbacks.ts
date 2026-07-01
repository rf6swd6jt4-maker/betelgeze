export type SeedSourceKey = "overture" | "osm" | "alltheplaces" | "foursquare_os_places"

export type SeedIndustryMapping = {
    icp_industry_value: string
    native_values: string[] | null
    native_label?: string | null
    metadata?: Record<string, unknown> | null
}

export type SeedLocationMapping = {
    icp_location_value: string
    native_values: string[] | null
    metadata?: Record<string, unknown> | null
}

export type SeedLocationTarget = {
    value: string
    label?: string | null
    location_kind?: string | null
    country?: string | null
    region?: string | null
    locality?: string | null
    latitude?: number | null
    longitude?: number | null
    radius_meters?: number | null
}

const GENERIC_SEED_TERMS: Record<SeedSourceKey, string[]> = {
    overture: ["contractor", "building_contractor", "construction_services"],
    osm: ["craft=builder", "office=construction_company"],
    alltheplaces: ["contractor", "builder", "construction", "home"],
    foursquare_os_places: ["contractor", "builder", "construction", "home"],
}

const INDUSTRY_SEED_TERMS: Record<string, Partial<Record<SeedSourceKey, string[]>>> = {
    auto_repair: {
        overture: ["auto_repair_shop", "car_repair", "auto_body_shop", "mechanic"],
        osm: ["shop=car_repair", "shop=car", "craft=mechanic"],
        alltheplaces: ["auto", "automotive", "mechanic", "repair", "tire"],
        foursquare_os_places: ["auto", "automotive", "mechanic", "repair", "tire"],
    },
    bathroom_remodelling: {
        overture: ["bathroom_remodeling", "contractor", "building_contractor", "construction_services"],
        osm: ["craft=builder", "office=construction_company", "shop=bathroom_furnishing"],
        alltheplaces: ["bath", "bathroom", "remodel", "contractor", "home", "hardware"],
        foursquare_os_places: ["bath", "bathroom", "remodel", "contractor", "home", "hardware"],
    },
    cleaning_companies: {
        overture: ["cleaning_service", "house_cleaning_service", "commercial_cleaning_service", "janitorial_service"],
        osm: ["shop=cleaning", "office=cleaning", "craft=cleaning"],
        alltheplaces: ["clean", "cleaning", "janitorial", "maid"],
        foursquare_os_places: ["clean", "cleaning", "janitorial", "maid"],
    },
    concrete_contractors: {
        overture: ["concrete_contractor", "contractor", "building_contractor", "construction_services"],
        osm: ["craft=concrete", "craft=builder", "office=construction_company"],
        alltheplaces: ["concrete", "cement", "contractor", "construction", "building"],
        foursquare_os_places: ["concrete", "cement", "contractor", "construction", "building"],
    },
    deck_builders: {
        overture: ["contractor", "building_contractor", "construction_services"],
        osm: ["craft=carpenter", "craft=builder", "office=construction_company"],
        alltheplaces: ["deck", "builder", "contractor", "carpenter", "construction", "home", "lumber"],
        foursquare_os_places: ["deck", "builder", "contractor", "carpenter", "construction", "home"],
    },
    electricians: {
        overture: ["electrician", "electrical_contractor", "lighting_contractor", "contractor"],
        osm: ["craft=electrician", "shop=electrical", "shop=lighting"],
        alltheplaces: ["electric", "electrical", "lighting", "contractor"],
        foursquare_os_places: ["electric", "electrical", "lighting", "contractor"],
    },
    excavation_contractors: {
        overture: ["excavating_contractor", "contractor", "construction_services"],
        osm: ["craft=excavation", "craft=builder", "office=construction_company"],
        alltheplaces: ["excavation", "excavating", "grading", "contractor", "construction"],
        foursquare_os_places: ["excavation", "excavating", "grading", "contractor", "construction"],
    },
    fencing_contractors: {
        overture: ["fence_contractor", "fence_supply_store", "contractor", "construction_services"],
        osm: ["craft=fence", "shop=fence", "craft=builder"],
        alltheplaces: ["fence", "fencing", "contractor", "home", "hardware"],
        foursquare_os_places: ["fence", "fencing", "contractor", "home", "hardware"],
    },
    flooring_contractors: {
        overture: ["flooring_contractors", "flooring_store", "contractor", "construction_services"],
        osm: ["shop=flooring", "craft=floorer", "craft=builder"],
        alltheplaces: ["floor", "flooring", "carpet", "tile", "contractor", "home"],
        foursquare_os_places: ["floor", "flooring", "carpet", "tile", "contractor", "home"],
    },
    garage_door_companies: {
        overture: ["garage_door_supplier", "door_supplier", "contractor", "building_contractor", "construction_services"],
        osm: ["shop=doors", "craft=garage_door", "craft=builder", "office=construction_company"],
        alltheplaces: ["garage", "door", "doors", "contractor", "repair", "home"],
        foursquare_os_places: ["garage", "door", "doors", "contractor", "repair", "home"],
    },
    general_contractors: {
        overture: ["general_contractor", "contractor", "building_contractor", "construction_company", "construction_services"],
        osm: ["office=construction_company", "craft=builder"],
        alltheplaces: ["contract", "contractor", "construction", "builder", "home", "hardware"],
        foursquare_os_places: ["contract", "contractor", "construction", "builder", "home", "hardware"],
    },
    hardscaping_contractors: {
        overture: ["landscaping", "contractor", "construction_services"],
        osm: ["craft=landscaper", "shop=garden_centre", "craft=builder"],
        alltheplaces: ["hardscape", "landscape", "paver", "stone", "contractor"],
        foursquare_os_places: ["hardscape", "landscape", "paver", "stone", "contractor"],
    },
    home_builders: {
        overture: ["home_builder", "building_contractor", "contractor", "construction_services"],
        osm: ["office=construction_company", "craft=builder", "craft=carpenter"],
        alltheplaces: ["home", "builder", "construction", "contractor"],
        foursquare_os_places: ["home", "builder", "construction", "contractor"],
    },
    hvac_contractors: {
        overture: ["hvac_contractor", "air_conditioning_contractor", "heating_contractor", "contractor", "construction_services"],
        osm: ["craft=hvac", "craft=heating_engineer", "craft=air_conditioning", "office=construction_company"],
        alltheplaces: ["hvac", "heating", "cooling", "air_conditioning", "contractor"],
        foursquare_os_places: ["hvac", "heating", "cooling", "air_conditioning", "contractor"],
    },
    insulation_contractors: {
        overture: ["insulation_contractor", "contractor", "construction_services"],
        osm: ["craft=insulation", "craft=builder", "office=construction_company"],
        alltheplaces: ["insulation", "contractor", "construction", "home"],
        foursquare_os_places: ["insulation", "contractor", "construction", "home"],
    },
    kitchen_remodelling: {
        overture: ["kitchen_remodeling", "contractor", "building_contractor", "construction_services"],
        osm: ["craft=builder", "office=construction_company", "shop=kitchen"],
        alltheplaces: ["kitchen", "remodel", "contractor", "home", "hardware"],
        foursquare_os_places: ["kitchen", "remodel", "contractor", "home", "hardware"],
    },
    landscapers: {
        overture: ["landscaping", "landscaper", "landscape_architect", "contractor"],
        osm: ["craft=landscaper", "shop=garden_centre", "shop=landscaping"],
        alltheplaces: ["garden", "landscape", "landscaping", "lawn", "nursery"],
        foursquare_os_places: ["garden", "landscape", "landscaping", "lawn", "nursery"],
    },
    lawn_care_companies: {
        overture: ["lawn_care_service", "landscaping", "landscaper"],
        osm: ["craft=landscaper", "shop=garden_centre"],
        alltheplaces: ["lawn", "garden", "landscape", "landscaping"],
        foursquare_os_places: ["lawn", "garden", "landscape", "landscaping"],
    },
    lighting_contractors: {
        overture: ["lighting_contractor", "electrician", "electrical_contractor", "lighting_store"],
        osm: ["shop=lighting", "craft=electrician", "shop=electrical"],
        alltheplaces: ["lighting", "electric", "electrical", "contractor"],
        foursquare_os_places: ["lighting", "electric", "electrical", "contractor"],
    },
    masonry_contractors: {
        overture: ["masonry_contractor", "contractor", "construction_services"],
        osm: ["craft=mason", "craft=stonemason", "craft=builder"],
        alltheplaces: ["masonry", "mason", "stone", "brick", "contractor"],
        foursquare_os_places: ["masonry", "mason", "stone", "brick", "contractor"],
    },
    painters: {
        overture: ["painting_contractor", "painter", "contractor", "construction_services"],
        osm: ["craft=painter", "shop=paint", "craft=builder"],
        alltheplaces: ["paint", "painting", "painter", "contractor"],
        foursquare_os_places: ["paint", "painting", "painter", "contractor"],
    },
    patio_contractors: {
        overture: ["patio_enclosure_supplier", "contractor", "building_contractor", "construction_services"],
        osm: ["craft=builder", "craft=carpenter", "craft=landscaper"],
        alltheplaces: ["patio", "deck", "paver", "contractor", "outdoor", "home"],
        foursquare_os_places: ["patio", "deck", "paver", "contractor", "outdoor", "home"],
    },
    pest_control: {
        overture: ["pest_control_service", "exterminator"],
        osm: ["shop=pest_control", "craft=pest_control", "office=pest_control"],
        alltheplaces: ["pest", "exterminator", "termite"],
        foursquare_os_places: ["pest", "exterminator", "termite"],
    },
    plumbers: {
        overture: ["plumber", "plumbing", "plumbing_service"],
        osm: ["craft=plumber", "shop=plumbing", "office=plumber"],
        alltheplaces: ["plumb", "plumbing", "plumber"],
        foursquare_os_places: ["plumb", "plumbing", "plumber"],
    },
    pool_builders: {
        overture: ["swimming_pool_contractor", "pool_cleaning_service", "contractor", "construction_services"],
        osm: ["shop=swimming_pool", "craft=pool", "craft=builder"],
        alltheplaces: ["pool", "pools", "swimming", "contractor"],
        foursquare_os_places: ["pool", "pools", "swimming", "contractor"],
    },
    remodellers: {
        overture: ["remodeler", "altering_and_remodeling_contractor", "home_improvement_contractor", "contractor", "construction_services"],
        osm: ["office=construction_company", "craft=builder", "craft=carpenter"],
        alltheplaces: ["remodel", "remodeling", "home", "hardware", "construction", "contractor"],
        foursquare_os_places: ["remodel", "remodeling", "home", "hardware", "construction", "contractor"],
    },
    restoration_companies: {
        overture: ["water_damage_restoration_service", "fire_damage_restoration_service", "contractor", "construction_services"],
        osm: ["craft=builder", "office=construction_company"],
        alltheplaces: ["restoration", "water_damage", "fire_damage", "repair", "home"],
        foursquare_os_places: ["restoration", "water_damage", "fire_damage", "repair", "home"],
    },
    roofers: {
        overture: ["roofing", "roofing_contractor", "roofer", "ceiling_and_roofing_repair_and_service"],
        osm: ["craft=roofer", "craft=builder"],
        alltheplaces: ["roof", "roofing", "roofer", "contractor"],
        foursquare_os_places: ["roof", "roofing", "roofer", "contractor"],
    },
    siding_contractors: {
        overture: ["siding_contractor", "contractor", "construction_services"],
        osm: ["craft=builder", "office=construction_company"],
        alltheplaces: ["siding", "exterior", "contractor", "home"],
        foursquare_os_places: ["siding", "exterior", "contractor", "home"],
    },
    solar_installers: {
        overture: ["solar_energy_contractor", "solar_energy_company", "electrician", "contractor", "construction_services"],
        osm: ["craft=solar", "shop=solar", "craft=electrician"],
        alltheplaces: ["solar", "electric", "electrical", "contractor"],
        foursquare_os_places: ["solar", "electric", "electrical", "contractor"],
    },
    tree_services: {
        overture: ["tree_service", "arborist", "landscaping", "logging_contractor"],
        osm: ["craft=arborist", "craft=landscaper", "shop=garden_centre"],
        alltheplaces: ["tree", "arborist", "garden", "landscape"],
        foursquare_os_places: ["tree", "arborist", "garden", "landscape"],
    },
    waste_disposal: {
        overture: ["waste_management_service", "garbage_collection_service", "junk_removal_service", "recycling_center"],
        osm: ["amenity=recycling", "shop=waste_disposal", "office=waste_management"],
        alltheplaces: ["waste", "junk", "recycling", "disposal", "sanitation"],
        foursquare_os_places: ["waste", "junk", "recycling", "disposal", "sanitation"],
    },
    water_well_services: {
        overture: ["well_drilling_contractor", "pump_supplier", "contractor", "construction_services"],
        osm: ["craft=well_drilling", "shop=pump", "craft=builder"],
        alltheplaces: ["well", "pump", "water", "drilling", "contractor"],
        foursquare_os_places: ["well", "pump", "water", "drilling", "contractor"],
    },
    window_and_door_contractors: {
        overture: ["window_installation_service", "door_supplier", "contractor", "building_contractor", "construction_services"],
        osm: ["shop=windows", "shop=doors", "craft=glazier", "craft=builder"],
        alltheplaces: ["window", "door", "doors", "contractor", "glazier", "home"],
        foursquare_os_places: ["window", "door", "doors", "contractor", "glazier", "home"],
    },
}

function humaniseIndustry(value: string) {
    return value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function compactValues(values: Array<string | null | undefined>) {
    return [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))]
}

function numericOrNull(value: unknown) {
    return typeof value === "number" && Number.isFinite(value) ? value : null
}

function targetMetadata(target: SeedLocationTarget | null | undefined) {
    if (!target) return {}
    return {
        fallback_target_label: target.label ?? target.value,
        country: target.country ?? null,
        region: target.region ?? null,
        locality: target.locality ?? null,
        location_kind: target.location_kind ?? null,
        latitude: numericOrNull(target.latitude),
        longitude: numericOrNull(target.longitude),
        radius_meters: numericOrNull(target.radius_meters),
    }
}

export function fallbackSeedNativeValues(sourceKey: SeedSourceKey, industryValue: string) {
    const sourceFallbacks = INDUSTRY_SEED_TERMS[industryValue]?.[sourceKey] ?? []
    const slugTerms = sourceKey === "osm"
        ? []
        : industryValue.split("_").filter((term) => term.length >= 3)
    return compactValues([...sourceFallbacks, ...slugTerms, ...GENERIC_SEED_TERMS[sourceKey]])
}

export function seedIndustryMappingsWithFallbacks<T extends SeedIndustryMapping>(
    sourceKey: SeedSourceKey,
    selectedIndustries: string[],
    mappings: T[]
): SeedIndustryMapping[] {
    const byIndustry = new Map<string, SeedIndustryMapping>()
    for (const mapping of mappings) {
        const existingValues = Array.isArray(mapping.native_values) ? mapping.native_values : []
        const nativeValues = compactValues([
            ...existingValues,
            ...fallbackSeedNativeValues(sourceKey, mapping.icp_industry_value),
        ])
        const existingOsmTags = Array.isArray(mapping.metadata?.osm_tags) ? mapping.metadata.osm_tags.map(String) : []
        byIndustry.set(mapping.icp_industry_value, {
            ...mapping,
            native_values: nativeValues,
            metadata: {
                ...(mapping.metadata ?? {}),
                seed_fallback_terms: true,
                ...(sourceKey === "osm" ? { osm_tags: compactValues([...existingOsmTags, ...nativeValues]) } : {}),
            },
        })
    }
    for (const industry of selectedIndustries) {
        if (byIndustry.has(industry)) continue
        const nativeValues = fallbackSeedNativeValues(sourceKey, industry)
        byIndustry.set(industry, {
            icp_industry_value: industry,
            native_values: nativeValues,
            native_label: `Fallback seed terms for ${humaniseIndustry(industry)}`,
            metadata: {
                generated_fallback_mapping: true,
                seed_fallback_terms: true,
                fallback_reason: "No exact seed-source industry mapping was configured.",
                ...(sourceKey === "osm" ? { osm_tags: nativeValues } : {}),
            },
        })
    }
    return [...byIndustry.values()].filter((mapping) => (mapping.native_values?.length ?? 0) > 0)
}

export function seedLocationMappingsWithFallbacks<T extends SeedLocationMapping>(
    selectedLocations: string[],
    mappings: T[],
    targets: SeedLocationTarget[] = []
): SeedLocationMapping[] {
    const targetsByValue = new Map(targets.map((target) => [target.value, target]))
    const byLocation = new Map<string, SeedLocationMapping>()
    for (const mapping of mappings) {
        const existingValues = Array.isArray(mapping.native_values) ? mapping.native_values : []
        const nativeValues = existingValues.length > 0 ? existingValues : [mapping.icp_location_value]
        const target = targetsByValue.get(mapping.icp_location_value)
        byLocation.set(mapping.icp_location_value, {
            ...mapping,
            native_values: compactValues(nativeValues),
            metadata: {
                ...targetMetadata(target),
                ...(mapping.metadata ?? {}),
                seed_fallback_locations: true,
            },
        })
    }
    for (const location of selectedLocations) {
        if (byLocation.has(location)) continue
        const target = targetsByValue.get(location)
        byLocation.set(location, {
            icp_location_value: location,
            native_values: [location],
            metadata: {
                ...targetMetadata(target),
                generated_fallback_mapping: true,
                seed_fallback_locations: true,
                fallback_reason: "No exact seed-source location mapping was configured.",
            },
        })
    }
    return [...byLocation.values()].filter((mapping) => (mapping.native_values?.length ?? 0) > 0)
}
