export type LeadgenSeedSourceKey = "overture" | "osm" | "alltheplaces" | "foursquare_os_places"
export type LeadgenEnrichmentSourceKey =
    | "website"
    | "phone.basic_format_validation"
    | "state_license.tx.tdlr"
    | "state_license.tx.plumbing"
    | "registry.tx.comptroller"
    | "state_license.tx.tda_pest"
    | "regulated.tx.tceq_waste"
    | "state_license.fl.dbpr"
    | "state_license.fl.electrical"
    | "registry.fl.sunbiz"
    | "state_license.fl.fdacs_pest"
    | "state_license.fl.fdacs_auto_repair"
    | "registry.fl.miami_dade_lbt"
    | "registry.fl.tampa_btr"
    | "registry.fl.jacksonville_btr"
    | "state_license.ca.cslb"
    | "state_license.ca.bar_auto_repair"
    | "state_license.ca.pest_control"
    | "registry.ca.bizfile"
    | "registry.ca.los_angeles_fbn"
    | "regulated.ca.calrecycle_waste"
    | "state_license.az.roc"
    | "state_license.az.pest_management"
    | "registry.az.corp_commission"
    | "state_license.nc.general_contractors"
    | "permits.tx.dallas"
    | "permits.tx.austin"
    | "permits.fl.orlando"
    | "permits.ca.los_angeles"
    | "permits.az.phoenix"
    | "registry.fl.orlando_btr"
    | "safety.osha"
    | "transport.fmcsa_safer"
    | "regulated.epa_echo"
    | "regulated.nppes"
    | "procurement.usaspending"
    | "web.rdap_whois"
    | "web.certificate_transparency"
    | "sam_gov"
export type LeadgenLegacySourceKey = "state_licensing"
export type LeadgenSourceKey = LeadgenSeedSourceKey | LeadgenEnrichmentSourceKey | LeadgenLegacySourceKey
export type LeadgenConfigKey = LeadgenSourceKey | "icp"

export type LeadgenSourceConfig = Partial<Record<LeadgenConfigKey, {
    industries?: string[]
    locations?: string[]
    enabled?: boolean
    limit?: number
    maxEnrichmentDepth?: number
    ownerRequired?: boolean
    radiusMeters?: number
    crawlDepth?: number
    timeoutSeconds?: number
    respectRobots?: boolean
    release?: string
    notes?: string
}>>

export type LeadgenSourcePlanItem = {
    key: LeadgenSourceKey
    label: string
    detail: string
    kind: "seed" | "enrichment"
    category: "general" | "location" | "industry"
    industries: string[]
    locations: string[]
    limit: number | null
    radiusMeters: number | null
    crawlDepth: number | null
    timeoutSeconds: number | null
    respectRobots: boolean | null
    release: string | null
    notes: string | null
}

export type LeadgenSourceOption = {
    value: Exclude<LeadgenSourceKey, LeadgenLegacySourceKey>
    label: string
    detail: string
    statusLabel: string
    notesPlaceholder: string
    kind: "seed" | "enrichment"
    category: "general" | "location" | "industry"
    implemented?: boolean
    envVar?: string
    setupHint?: string
}

export const seedLeadgenSources = new Set<LeadgenSourceKey>(["overture", "osm", "alltheplaces", "foursquare_os_places"])
export const enrichmentLeadgenSources = new Set<LeadgenSourceKey>([
    "website",
    "phone.basic_format_validation",
    "state_license.tx.tdlr",
    "state_license.tx.plumbing",
    "registry.tx.comptroller",
    "state_license.tx.tda_pest",
    "regulated.tx.tceq_waste",
    "state_license.fl.dbpr",
    "state_license.fl.electrical",
    "registry.fl.sunbiz",
    "state_license.fl.fdacs_pest",
    "state_license.fl.fdacs_auto_repair",
    "registry.fl.miami_dade_lbt",
    "registry.fl.tampa_btr",
    "registry.fl.jacksonville_btr",
    "state_license.ca.cslb",
    "state_license.ca.bar_auto_repair",
    "state_license.ca.pest_control",
    "registry.ca.bizfile",
    "registry.ca.los_angeles_fbn",
    "regulated.ca.calrecycle_waste",
    "state_license.az.roc",
    "state_license.az.pest_management",
    "registry.az.corp_commission",
    "state_license.nc.general_contractors",
    "permits.tx.dallas",
    "permits.tx.austin",
    "permits.fl.orlando",
    "permits.ca.los_angeles",
    "permits.az.phoenix",
    "registry.fl.orlando_btr",
    "safety.osha",
    "transport.fmcsa_safer",
    "regulated.epa_echo",
    "regulated.nppes",
    "procurement.usaspending",
    "web.rdap_whois",
    "web.certificate_transparency",
    "sam_gov",
])
export const stateLicensingSourceKeys = new Set<LeadgenSourceKey>([
    "state_license.tx.tdlr",
    "state_license.tx.plumbing",
    "state_license.fl.dbpr",
    "state_license.fl.electrical",
    "state_license.nc.general_contractors",
    "state_licensing",
])
export const executableLeadgenSources = new Set<LeadgenSourceKey>([
    ...seedLeadgenSources,
    "website",
    "phone.basic_format_validation",
    "state_license.tx.tdlr",
    "state_license.tx.plumbing",
    "registry.tx.comptroller",
    "state_license.fl.dbpr",
    "state_license.fl.electrical",
    "state_license.nc.general_contractors",
    "permits.tx.dallas",
    "permits.tx.austin",
    "permits.fl.orlando",
    "permits.ca.los_angeles",
    "registry.fl.orlando_btr",
    "safety.osha",
    "transport.fmcsa_safer",
    "regulated.epa_echo",
    "regulated.nppes",
    "procurement.usaspending",
    "web.rdap_whois",
    "web.certificate_transparency",
    "sam_gov",
    "state_licensing",
])

export const leadgenSourceOptions: LeadgenSourceOption[] = [
    {
        value: "overture",
        label: "Overture Places",
        detail: "Primary open places database. Uses ICP mappings to query Overture categories and regions from the public GeoParquet dataset.",
        statusLabel: "Executable, no key",
        notesPlaceholder: "Release pin, category exclusions, confidence thresholds, or bounding-box notes.",
        kind: "seed",
        category: "general",
        implemented: true,
        setupHint: "No API key is needed. Betelgeze queries Overture's public GeoParquet release with DuckDB.",
    },
    {
        value: "osm",
        label: "OpenStreetMap raw data",
        detail: "Secondary seed source from public OSM data through Overpass. Runs with tight mapped location/category tasks to avoid abusing free public infrastructure.",
        statusLabel: "Executable, no key",
        notesPlaceholder: "OSM tags, fallback search terms, or public Overpass caution notes.",
        kind: "seed",
        category: "general",
        implemented: true,
        setupHint: "No API key is needed. The worker spaces requests across public Overpass endpoints and keeps per-task limits conservative.",
    },
    {
        value: "alltheplaces",
        label: "AllThePlaces",
        detail: "Secondary seed source from the public AllThePlaces run archive. Reads only small matching GeoJSON files by ZIP byte range instead of downloading the full archive.",
        statusLabel: "Executable, no key",
        notesPlaceholder: "Release id, spider exclusions, or brand/category notes.",
        kind: "seed",
        category: "general",
        implemented: true,
        setupHint: "No API key is needed. The worker uses the latest public run unless a release id is pinned.",
    },
    {
        value: "foursquare_os_places",
        label: "Foursquare OS Places",
        detail: "Secondary seed source from Foursquare OS Places PMTiles. Requires a configured PMTiles URL from the Foursquare Places Portal or another accessible mirror.",
        statusLabel: "Executable after PMTiles URL is configured",
        notesPlaceholder: "PMTiles source, category terms, or coverage limitations.",
        kind: "seed",
        category: "general",
        implemented: true,
        envVar: "FOURSQUARE_OS_PLACES_PMTILES_URL",
        setupHint: "Add FOURSQUARE_OS_PLACES_PMTILES_URL in Vercel. The source cannot run without a byte-range-readable PMTiles URL.",
    },
    {
        value: "website",
        label: "Website crawler",
        detail: "Owner and phone discovery from collected candidate websites. Runs after seed candidates exist.",
        statusLabel: "Executable after candidates exist",
        notesPlaceholder: "Pages to inspect, owner-title patterns, or domains to skip.",
        kind: "enrichment",
        category: "general",
        implemented: true,
    },
    {
        value: "phone.basic_format_validation",
        label: "Basic phone format validation",
        detail: "Internal first-pass owner-phone validation. Normalises owner numbers into US/E.164-style callable-length numbers and records that line type/mobile reachability is still unknown.",
        statusLabel: "Internal format validation",
        notesPlaceholder: "Validation thresholds or future carrier lookup notes.",
        kind: "enrichment",
        category: "general",
        implemented: true,
        setupHint: "No API key is needed. This does not prove mobile line type; it only prevents malformed owner numbers from counting as callable.",
    },
    {
        value: "web.rdap_whois",
        label: "Domain RDAP / WHOIS",
        detail: "Free RDAP lookup for candidate website domains. Provides domain registration support and age/status context, but modern records are usually privacy-redacted and do not count as owner-phone evidence.",
        statusLabel: "Executable, no key",
        notesPlaceholder: "TLD coverage, redaction caveats, or domain-age notes.",
        kind: "enrichment",
        category: "general",
        implemented: true,
        setupHint: "No API key is needed. Betelgeze only queries public RDAP for .com/.net domains with a candidate website.",
    },
    {
        value: "web.certificate_transparency",
        label: "Certificate transparency",
        detail: "Free certificate transparency lookup for candidate website domains. Confirms domain activity through public certificate logs, but does not expose owner identity or phone evidence.",
        statusLabel: "Executable, no key",
        notesPlaceholder: "crt.sh limits, certificate matching notes, or domain activity caveats.",
        kind: "enrichment",
        category: "general",
        implemented: true,
        setupHint: "No API key is needed. This source only runs when a candidate has a website domain.",
    },
    {
        value: "state_license.tx.tdlr",
        label: "Texas TDLR licensing",
        detail: "Texas Department of Licensing and Regulation adapter for mapped trades such as HVAC, electrical, and water well services.",
        statusLabel: "Executable for mapped Texas licensing categories",
        notesPlaceholder: "License statuses, endorsements, counties, or Texas exclusions.",
        kind: "enrichment",
        category: "location",
        implemented: true,
    },
    {
        value: "state_license.tx.plumbing",
        label: "Texas plumbing examiners",
        detail: "Texas State Board of Plumbing Examiners Responsible Master Plumber CSV. Matches Texas plumbing candidates to current RMP rows with company name, license holder, phone, county, status, and expiry.",
        statusLabel: "Executable from public CSV",
        notesPlaceholder: "RMP matching rules, status filters, or Texas plumbing county notes.",
        kind: "enrichment",
        category: "location",
        implemented: true,
        setupHint: "No API key is needed. Betelgeze reads the public Responsible Master Plumber CSV and treats licensee phone as owner/principal phone evidence.",
    },
    {
        value: "registry.tx.comptroller",
        label: "Texas Comptroller franchise tax officers",
        detail: "Texas Comptroller franchise-tax account-status search. Matches Texas entities to registered agent and Public Information Report officer rows exposed by the free Comptroller JSON endpoint.",
        statusLabel: "Executable, no key",
        notesPlaceholder: "Registered-agent weighting, PIR officer-title filters, or inactive-entity handling.",
        kind: "enrichment",
        category: "location",
        implemented: true,
        setupHint: "No API key is needed. This source can provide owner/principal names, but not owner-phone numbers.",
    },
    {
        value: "state_license.tx.tda_pest",
        label: "Texas Agriculture structural pest licenses",
        detail: "Texas Department of Agriculture structural pest-control licensing. Intended for Texas pest-control and lawn-treatment businesses where licensee or certified applicator names can support owner discovery.",
        statusLabel: "Catalogued, adapter needed",
        notesPlaceholder: "License search endpoint, applicator/title filters, or pest-category caveats.",
        kind: "enrichment",
        category: "industry",
        implemented: false,
        setupHint: "Catalogued as a free target source, but no stable automated adapter is wired yet.",
    },
    {
        value: "regulated.tx.tceq_waste",
        label: "Texas TCEQ regulated waste records",
        detail: "Texas Commission on Environmental Quality regulated-entity records for waste, septic, environmental, and disposal-adjacent businesses. Useful for principal/contact discovery once a pullable record path is verified.",
        statusLabel: "Catalogued, adapter needed",
        notesPlaceholder: "Registry endpoint, contact fields, or waste-program filters.",
        kind: "enrichment",
        category: "industry",
        implemented: false,
        setupHint: "Catalogued as a free target source, but no stable automated adapter is wired yet.",
    },
    {
        value: "state_license.fl.dbpr",
        label: "Florida DBPR construction",
        detail: "Florida DBPR construction public-record CSV for active building, residential, general, roofing, mechanical, air-conditioning, plumbing, pool, solar, and utility contractor records.",
        statusLabel: "Executable from public CSV",
        notesPlaceholder: "Construction code filters, active-status rules, or DBPR match confidence notes.",
        kind: "enrichment",
        category: "location",
        implemented: true,
        setupHint: "No API key is needed. DBPR construction records usually prove the qualifier/person and business, but usually do not expose a phone field.",
    },
    {
        value: "state_license.fl.electrical",
        label: "Florida DBPR electrical records",
        detail: "Florida DBPR electrical contractor CSV lookup for Florida candidates in mapped electrical-adjacent industries.",
        statusLabel: "Executable for mapped Florida electrical categories",
        notesPlaceholder: "License status rules, Florida county/city caveats, or DBPR match confidence notes.",
        kind: "enrichment",
        category: "location",
        implemented: true,
    },
    {
        value: "registry.fl.sunbiz",
        label: "Florida Sunbiz officers",
        detail: "Florida Division of Corporations Sunbiz entity records. Intended to match Florida businesses to officers, managers, registered agents, and annual-report names.",
        statusLabel: "Catalogued, blocked by challenge",
        notesPlaceholder: "Entity-search parser notes, officer-title filters, or challenge status.",
        kind: "enrichment",
        category: "location",
        implemented: false,
        setupHint: "Sunbiz is free to inspect manually, but the public search is currently challenge-protected for automated polling.",
    },
    {
        value: "state_license.fl.fdacs_pest",
        label: "Florida FDACS pest control licenses",
        detail: "Florida Department of Agriculture and Consumer Services pest-control licensing records for Florida pest-control and lawn-treatment businesses.",
        statusLabel: "Catalogued, adapter needed",
        notesPlaceholder: "FDACS license classes, certified-operator fields, or business-name filters.",
        kind: "enrichment",
        category: "industry",
        implemented: false,
        setupHint: "Catalogued as a free target source, but no stable automated adapter is wired yet.",
    },
    {
        value: "state_license.fl.fdacs_auto_repair",
        label: "Florida FDACS motor vehicle repair registrations",
        detail: "Florida FDACS motor vehicle repair shop registrations for Florida auto-repair businesses. Can support owner or registered-contact discovery when parsed.",
        statusLabel: "Catalogued, adapter needed",
        notesPlaceholder: "Registration fields, shop-status filters, or owner/contact confidence rules.",
        kind: "enrichment",
        category: "industry",
        implemented: false,
        setupHint: "Catalogued as a free target source, but no stable automated adapter is wired yet.",
    },
    {
        value: "registry.fl.miami_dade_lbt",
        label: "Miami-Dade local business tax receipts",
        detail: "Miami-Dade local business tax records. Intended to expose business owner or registered contact names for county-area home-service businesses.",
        statusLabel: "Catalogued, adapter needed",
        notesPlaceholder: "County search endpoint, receipt-status filters, or owner-field notes.",
        kind: "enrichment",
        category: "location",
        implemented: false,
        setupHint: "Catalogued as a free target source, but no stable automated adapter is wired yet.",
    },
    {
        value: "registry.fl.tampa_btr",
        label: "Tampa business tax receipts",
        detail: "City of Tampa business tax receipt records. Intended for owner/contact-name discovery in Tampa-area home services.",
        statusLabel: "Catalogued, adapter needed",
        notesPlaceholder: "BTR search endpoint, receipt-status filters, or owner-field notes.",
        kind: "enrichment",
        category: "location",
        implemented: false,
        setupHint: "Catalogued as a free target source, but no stable automated adapter is wired yet.",
    },
    {
        value: "registry.fl.jacksonville_btr",
        label: "Jacksonville business tax receipts",
        detail: "Jacksonville business tax receipt records. Intended for owner/contact-name discovery in Jacksonville-area home services.",
        statusLabel: "Catalogued, adapter needed",
        notesPlaceholder: "BTR search endpoint, receipt-status filters, or owner-field notes.",
        kind: "enrichment",
        category: "location",
        implemented: false,
        setupHint: "Catalogued as a free target source, but no stable automated adapter is wired yet.",
    },
    {
        value: "state_license.ca.cslb",
        label: "California CSLB contractor licenses",
        detail: "California Contractors State License Board search for contractor businesses, license personnel, and home-improvement salesperson records across CA trades.",
        statusLabel: "Catalogued, form parser needed",
        notesPlaceholder: "License-class filters, personnel roles, or captcha/form-post notes.",
        kind: "enrichment",
        category: "location",
        implemented: false,
        setupHint: "The free CSLB search is catalogued, but the automated adapter is not wired yet.",
    },
    {
        value: "state_license.ca.bar_auto_repair",
        label: "California BAR auto-repair registrations",
        detail: "California Bureau of Automotive Repair license lookup for registered auto-repair dealers and stations.",
        statusLabel: "Catalogued, adapter needed",
        notesPlaceholder: "BAR license classes, owner/contact fields, or station filters.",
        kind: "enrichment",
        category: "industry",
        implemented: false,
        setupHint: "Catalogued as a free target source, but no stable automated adapter is wired yet.",
    },
    {
        value: "state_license.ca.pest_control",
        label: "California Structural Pest Control Board",
        detail: "California Structural Pest Control Board license lookup for pest-control companies and operators.",
        statusLabel: "Catalogued, adapter needed",
        notesPlaceholder: "Branch/license filters, operator fields, or company-name matching rules.",
        kind: "enrichment",
        category: "industry",
        implemented: false,
        setupHint: "Catalogued as a free target source, but no stable automated adapter is wired yet.",
    },
    {
        value: "registry.ca.bizfile",
        label: "California Bizfile officers",
        detail: "California Secretary of State Bizfile entity search. Intended to connect CA businesses to registered agents, officers, managers, or entity filings.",
        statusLabel: "Catalogued, adapter needed",
        notesPlaceholder: "Entity-search parser, filing-title filters, or registered-agent confidence notes.",
        kind: "enrichment",
        category: "location",
        implemented: false,
        setupHint: "Catalogued as a free target source, but no stable automated adapter is wired yet.",
    },
    {
        value: "registry.ca.los_angeles_fbn",
        label: "Los Angeles County fictitious business names",
        detail: "Los Angeles County fictitious business name records. Useful for sole-proprietor and DBA owner-name discovery once parsed.",
        statusLabel: "Catalogued, adapter needed",
        notesPlaceholder: "FBN search endpoint, registrant-field filters, or DBA confidence rules.",
        kind: "enrichment",
        category: "location",
        implemented: false,
        setupHint: "Catalogued as a free target source, but no stable automated adapter is wired yet.",
    },
    {
        value: "regulated.ca.calrecycle_waste",
        label: "California CalRecycle waste hauler records",
        detail: "CalRecycle and related public waste/hauler records for California waste-disposal and recycling businesses.",
        statusLabel: "Catalogued, adapter needed",
        notesPlaceholder: "Facility/hauler datasets, contact fields, or waste-category filters.",
        kind: "enrichment",
        category: "industry",
        implemented: false,
        setupHint: "Catalogued as a free target source, but no stable automated adapter is wired yet.",
    },
    {
        value: "state_license.az.roc",
        label: "Arizona Registrar of Contractors",
        detail: "Arizona Registrar of Contractors license search for contractors, qualifiers, and license-principal records.",
        statusLabel: "Catalogued, blocked by challenge",
        notesPlaceholder: "ROC license-class filters, qualifier fields, or challenge status.",
        kind: "enrichment",
        category: "location",
        implemented: false,
        setupHint: "The free ROC search is catalogued, but automated polling is currently blocked by the public site.",
    },
    {
        value: "state_license.az.pest_management",
        label: "Arizona pest management licenses",
        detail: "Arizona pest-management licensing records for pest-control and treatment businesses.",
        statusLabel: "Catalogued, adapter needed",
        notesPlaceholder: "License categories, qualifying-party fields, or business-name matching notes.",
        kind: "enrichment",
        category: "industry",
        implemented: false,
        setupHint: "Catalogued as a free target source, but no stable automated adapter is wired yet.",
    },
    {
        value: "registry.az.corp_commission",
        label: "Arizona Corporation Commission entity officers",
        detail: "Arizona Corporation Commission entity records. Intended to match AZ businesses to statutory agents, officers, members, and entity filings.",
        statusLabel: "Catalogued, blocked by challenge",
        notesPlaceholder: "Entity-search parser notes, officer-title filters, or challenge status.",
        kind: "enrichment",
        category: "location",
        implemented: false,
        setupHint: "The free AZCC search is catalogued, but automated polling is currently blocked by the public site.",
    },
    {
        value: "state_license.nc.general_contractors",
        label: "North Carolina general contractor search",
        detail: "North Carolina Licensing Board for General Contractors search for mapped NC contractor/remodelling candidates.",
        statusLabel: "Executable for mapped North Carolina GC categories",
        notesPlaceholder: "Classification ids, active-status rules, or name matching notes.",
        kind: "enrichment",
        category: "location",
        implemented: true,
    },
    {
        value: "permits.tx.dallas",
        label: "Dallas active contractor registrations",
        detail: "Dallas Open Data active contractor registrations. Provides city registration support and contractor business phone evidence for Dallas-area candidates.",
        statusLabel: "Executable from public API",
        notesPlaceholder: "Dallas contractor registration match rules or phone confidence notes.",
        kind: "enrichment",
        category: "location",
        implemented: true,
    },
    {
        value: "permits.tx.austin",
        label: "Austin ROW contractor licences",
        detail: "Austin public active right-of-way contractor license holders. Provides contractor license activity support for Austin-area candidates.",
        statusLabel: "Executable from public API",
        notesPlaceholder: "Austin ROW license filters or local trade notes.",
        kind: "enrichment",
        category: "location",
        implemented: true,
    },
    {
        value: "permits.fl.orlando",
        label: "Orlando permit applications",
        detail: "Orlando permit applications dataset. Matches contractor records and can expose permit contact or qualifier details for Orlando candidates.",
        statusLabel: "Executable from public API",
        notesPlaceholder: "Permit status filters, contractor phone confidence, or work-type notes.",
        kind: "enrichment",
        category: "location",
        implemented: true,
    },
    {
        value: "registry.fl.orlando_btr",
        label: "Orlando business tax receipts",
        detail: "Orlando business tax receipts dataset. Can expose business owner name and phone on the same official row for Orlando candidates.",
        statusLabel: "Executable from public API",
        notesPlaceholder: "BTR status filters, owner-phone confidence, or city category notes.",
        kind: "enrichment",
        category: "location",
        implemented: true,
    },
    {
        value: "safety.osha",
        label: "OSHA establishment search",
        detail: "Official OSHA establishment search. Provides broad contractor activity/support evidence for businesses with inspection history, but does not expose owner phone evidence.",
        statusLabel: "Executable, no key",
        notesPlaceholder: "Inspection date windows, establishment matching rules, or safety-source caveats.",
        kind: "enrichment",
        category: "industry",
        implemented: true,
        setupHint: "No API key is needed. This runs as business-validation support only.",
    },
    {
        value: "permits.ca.los_angeles",
        label: "Los Angeles permits",
        detail: "Los Angeles permits since 2018. Provides contractor business and permit-principal support for Los Angeles candidates.",
        statusLabel: "Executable from public API",
        notesPlaceholder: "Permit category filters, principal confidence, or Los Angeles limitations.",
        kind: "enrichment",
        category: "location",
        implemented: true,
    },
    {
        value: "permits.az.phoenix",
        label: "Phoenix permits",
        detail: "Phoenix permit and contractor records. Intended to expose permit principals, contractors, or registered contacts for Phoenix-area trades once a stable public endpoint is wired.",
        statusLabel: "Catalogued, adapter needed",
        notesPlaceholder: "Permit endpoint, contractor-field mapping, or Phoenix work-type filters.",
        kind: "enrichment",
        category: "location",
        implemented: false,
        setupHint: "Catalogued as a free target source, but no stable automated adapter is wired yet.",
    },
    {
        value: "transport.fmcsa_safer",
        label: "FMCSA SAFER company snapshot",
        detail: "Official carrier registration lookup for moving, trucking, hauling, freight, and adjacent transport-heavy candidates. Provides official business phone/support evidence, but does not count as direct owner-phone proof by itself.",
        statusLabel: "Executable for mapped transport categories",
        notesPlaceholder: "USDOT confidence rules, carrier status filters, or transport category caveats.",
        kind: "enrichment",
        category: "industry",
        implemented: true,
        setupHint: "No API key is needed. Betelgeze uses the public FMCSA SAFER snapshot lookup with conservative per-candidate requests.",
    },
    {
        value: "regulated.epa_echo",
        label: "EPA ECHO facility search",
        detail: "EPA ECHO facility lookup for waste, environmental, remediation, septic, well, and industrial cleaning candidates. Provides regulated-facility support evidence.",
        statusLabel: "Executable, no key",
        notesPlaceholder: "Facility name matching rules, program filters, or environmental contractor notes.",
        kind: "enrichment",
        category: "industry",
        implemented: true,
        setupHint: "No API key is needed. Betelgeze queries the public EPA ECHO REST service for mapped environmental and waste-adjacent candidates.",
    },
    {
        value: "regulated.nppes",
        label: "NPPES NPI Registry",
        detail: "Official NPI Registry lookup for healthcare ICPs. Organization records can include authorized official name and phone, which Betelgeze treats as owner/principal phone evidence.",
        statusLabel: "Executable for mapped healthcare categories",
        notesPlaceholder: "Healthcare taxonomy filters, authorized-official confidence rules, or practice-type exclusions.",
        kind: "enrichment",
        category: "industry",
        implemented: true,
        setupHint: "No API key is needed. Betelgeze queries the public NPPES API only for mapped healthcare candidates.",
    },
    {
        value: "procurement.usaspending",
        label: "USAspending federal awards",
        detail: "Official USAspending public API. Provides federal award/vendor activity support for contractor candidates, but does not expose direct owner phone evidence.",
        statusLabel: "Executable, no key",
        notesPlaceholder: "Award windows, NAICS matching notes, or procurement-source caveats.",
        kind: "enrichment",
        category: "industry",
        implemented: true,
        setupHint: "No API key is needed. This runs as business-validation support only.",
    },
    {
        value: "sam_gov",
        label: "SAM.gov",
        detail: "Very scarce validation and public POC lookup for mapped NAICS, entity identity, and contact evidence. Kept to one mapped task per poll because basic API quotas are strict.",
        statusLabel: "Executable with key, rate-limited hard",
        notesPlaceholder: "NAICS filters, POC confidence rules, or entity-status constraints.",
        kind: "enrichment",
        category: "industry",
        implemented: true,
        envVar: "SAM_GOV_API_KEY",
        setupHint: "Add SAM_GOV_API_KEY in Vercel. Betelgeze only runs this source sparingly because SAM.gov quota windows are tight.",
    },
]

const optionByKey = new Map<LeadgenSourceKey, LeadgenSourceOption | { value: LeadgenLegacySourceKey; label: string; detail: string; kind: "enrichment"; category: "industry" }>([
    ...leadgenSourceOptions.map((source) => [source.value, source] as const),
    ["state_licensing", { value: "state_licensing", label: "State licensing boards (legacy)", detail: "Legacy saved setting mapped to the split board adapters.", kind: "enrichment", category: "industry" }],
])

export function normaliseLeadgenSourceKey(value: string): LeadgenSourceKey | null {
    if (optionByKey.has(value as LeadgenSourceKey)) return value as LeadgenSourceKey
    return null
}

export function sourceLabel(key: string) {
    return optionByKey.get(key as LeadgenSourceKey)?.label ?? key
}

export function buildSourcePlan(enabledSources: string[], sourceConfig: Partial<LeadgenSourceConfig> | null | undefined): LeadgenSourcePlanItem[] {
    const icpConfig = sourceConfig?.icp
    const industries = Array.isArray(icpConfig?.industries) ? icpConfig.industries.map(String).filter(Boolean) : []
    const locations = Array.isArray(icpConfig?.locations) ? icpConfig.locations.map(String).filter(Boolean) : []
    return enabledSources
        .map(normaliseLeadgenSourceKey)
        .filter((key): key is LeadgenSourceKey => Boolean(key))
        .map((key) => {
            const option = optionByKey.get(key)!
            const sourceSpecificConfig = sourceConfig?.[key]
            return {
                key,
                label: option.label,
                detail: option.detail,
                kind: option.kind,
                category: option.category,
                industries,
                locations,
                limit: typeof sourceSpecificConfig?.limit === "number" ? sourceSpecificConfig.limit : typeof icpConfig?.limit === "number" ? icpConfig.limit : null,
                radiusMeters: typeof sourceSpecificConfig?.radiusMeters === "number" ? sourceSpecificConfig.radiusMeters : null,
                crawlDepth: typeof sourceSpecificConfig?.crawlDepth === "number" ? sourceSpecificConfig.crawlDepth : null,
                timeoutSeconds: typeof sourceSpecificConfig?.timeoutSeconds === "number" ? sourceSpecificConfig.timeoutSeconds : null,
                respectRobots: typeof sourceSpecificConfig?.respectRobots === "boolean" ? sourceSpecificConfig.respectRobots : null,
                release: sourceSpecificConfig?.release?.trim() || null,
                notes: sourceSpecificConfig?.notes?.trim() || icpConfig?.notes?.trim() || null,
            }
        })
}
