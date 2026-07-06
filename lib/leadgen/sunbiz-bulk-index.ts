export type SunbizOwnerIndexRow = {
    source_key: "registry.fl.sunbiz" | "registry.fl.fictitious_names"
    record_id: string
    business_name: string
    status: string | null
    record_type: string | null
    person_name: string
    person_role: string
    person_source_field: string
    person_type: string | null
    address: Record<string, unknown>
    search_text: string
    raw_payload: Record<string, unknown>
}

function fixed(value: string, start: number, length: number) {
    return value.slice(start - 1, start - 1 + length).trim()
}

function compact(value: string | null | undefined) {
    return (value ?? "").replace(/\s+/g, " ").trim()
}

export function normaliseSunbizIndexSearchText(value: string | null | undefined) {
    return compact(value)
        .toLowerCase()
        .replace(/\b(?:llc|l\.l\.c\.?|inc|incorporated|corp|corporation|co|company|ltd|limited|lp|llp|pllc|p\.a\.|pa|pc)\b/g, " ")
        .replace(/[^a-z0-9]+/g, " ")
        .replace(/\s+/g, " ")
        .trim()
}

function searchText(...values: Array<string | null | undefined>) {
    return [...new Set(values.map(normaliseSunbizIndexSearchText).filter(Boolean))].join(" ")
}

function statusLabel(value: string) {
    if (value === "A") return "Active"
    if (value === "I") return "Inactive"
    if (value === "C") return "Cancelled"
    if (value === "E") return "Expired"
    return value || null
}

function personTypeLabel(value: string) {
    if (value === "P") return "Person"
    if (value === "C") return "Corporation"
    return value || null
}

function addressPayload(street: string, city: string, state: string, postcode: string, country = "US") {
    return {
        street: compact(street) || null,
        city: compact(city) || null,
        state: compact(state) || null,
        postcode: compact(postcode) || null,
        country,
    }
}

function corporateOfficerSlots(line: string) {
    return [
        { slot: 1, title: fixed(line, 669, 4), type: fixed(line, 673, 1), name: fixed(line, 674, 42), addressStart: 716, cityStart: 758, stateStart: 786, zipStart: 788 },
        { slot: 2, title: fixed(line, 797, 4), type: fixed(line, 801, 1), name: fixed(line, 802, 42), addressStart: 844, cityStart: 886, stateStart: 914, zipStart: 916 },
        { slot: 3, title: fixed(line, 925, 4), type: fixed(line, 929, 1), name: fixed(line, 930, 42), addressStart: 972, cityStart: 1014, stateStart: 1042, zipStart: 1044 },
        { slot: 4, title: fixed(line, 1053, 4), type: fixed(line, 1057, 1), name: fixed(line, 1058, 42), addressStart: 1100, cityStart: 1142, stateStart: 1170, zipStart: 1172 },
        { slot: 5, title: fixed(line, 1181, 4), type: fixed(line, 1185, 1), name: fixed(line, 1186, 42), addressStart: 1228, cityStart: 1270, stateStart: 1298, zipStart: 1300 },
        { slot: 6, title: fixed(line, 1309, 4), type: fixed(line, 1313, 1), name: fixed(line, 1314, 42), addressStart: 1356, cityStart: 1398, stateStart: 1426, zipStart: 1428 },
    ]
}

function officerRole(title: string) {
    const clean = title || "officer"
    return `officer_${clean.toLowerCase()}`
}

export function parseSunbizCorporateOwnerRows(line: string): SunbizOwnerIndexRow[] {
    const recordId = fixed(line, 1, 12)
    const businessName = fixed(line, 13, 192)
    if (!recordId || !businessName) return []
    const status = fixed(line, 205, 1)
    const recordType = fixed(line, 206, 15)
    const baseAddress = addressPayload(fixed(line, 221, 42), fixed(line, 305, 28), fixed(line, 333, 2), fixed(line, 335, 10))
    return corporateOfficerSlots(line)
        .filter((officer) => officer.name && officer.type !== "C")
        .map((officer) => {
            const address = addressPayload(
                fixed(line, officer.addressStart, 42),
                fixed(line, officer.cityStart, 28),
                fixed(line, officer.stateStart, 2),
                fixed(line, officer.zipStart, 9)
            )
            return {
                source_key: "registry.fl.sunbiz",
                record_id: `${recordId}:officer:${officer.slot}`,
                business_name: businessName,
                status: statusLabel(status),
                record_type: recordType || "Florida corporate filing",
                person_name: officer.name,
                person_role: officerRole(officer.title),
                person_source_field: `officer_${officer.slot}_name`,
                person_type: personTypeLabel(officer.type),
                address,
                search_text: searchText(businessName, recordId, officer.name),
                raw_payload: {
                    document_number: recordId,
                    filing_type: recordType,
                    entity_status: status,
                    principal_address: baseAddress,
                    officer_title: officer.title,
                    officer_slot: officer.slot,
                },
            }
        })
}

function fictitiousOwnerSlots(line: string) {
    const slots = []
    for (let slot = 1, start = 389; slot <= 10; slot += 1, start += 171) {
        slots.push({
            slot,
            documentNumber: fixed(line, start, 12),
            name: fixed(line, start + 12, 55),
            type: fixed(line, start + 67, 1),
            address: fixed(line, start + 68, 40),
            city: fixed(line, start + 108, 28),
            state: fixed(line, start + 136, 2),
            postcode: fixed(line, start + 138, 10),
            country: fixed(line, start + 148, 2) || "US",
        })
    }
    return slots
}

export function parseSunbizFictitiousNameOwnerRows(line: string): SunbizOwnerIndexRow[] {
    const recordId = fixed(line, 1, 12)
    const businessName = fixed(line, 13, 192)
    if (!recordId || !businessName) return []
    const status = fixed(line, 352, 1)
    const baseAddress = addressPayload(fixed(line, 217, 40), fixed(line, 297, 28), fixed(line, 325, 2), fixed(line, 327, 10), fixed(line, 337, 2) || "US")
    return fictitiousOwnerSlots(line)
        .filter((owner) => owner.name && owner.type !== "C")
        .map((owner) => ({
            source_key: "registry.fl.fictitious_names",
            record_id: `${recordId}:owner:${owner.slot}`,
            business_name: businessName,
            status: statusLabel(status),
            record_type: "Florida fictitious name registration",
            person_name: owner.name,
            person_role: "fictitious_name_owner",
            person_source_field: `owner_${owner.slot}_name`,
            person_type: personTypeLabel(owner.type),
            address: addressPayload(owner.address, owner.city, owner.state, owner.postcode, owner.country),
            search_text: searchText(businessName, recordId, owner.name),
            raw_payload: {
                document_number: recordId,
                filing_status: status,
                filing_address: baseAddress,
                owner_document_number: owner.documentNumber,
                owner_slot: owner.slot,
            },
        }))
}

export function parseSunbizOwnerIndexRows(sourceKey: SunbizOwnerIndexRow["source_key"], text: string) {
    return text
        .split(/\r?\n/)
        .flatMap((line) => {
            if (!line.trim()) return []
            return sourceKey === "registry.fl.sunbiz"
                ? parseSunbizCorporateOwnerRows(line)
                : parseSunbizFictitiousNameOwnerRows(line)
        })
}
