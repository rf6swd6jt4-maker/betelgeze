type OvertureLocation = {
    label?: string | null
    latitude?: number | null
    longitude?: number | null
    radiusMeters?: number | null
}

export type OverturePlaceRecord = {
    id: string
    name: string | null
    phone: string | null
    website_url: string | null
    address: Record<string, unknown>
    latitude: number | null
    longitude: number | null
    categories: Array<{ key: string; value: string }>
    raw_payload: Record<string, unknown>
}

const DEFAULT_RELEASE = "2026-06-17.0"

function sqlString(value: string) {
    return `'${value.replace(/'/g, "''")}'`
}

function sqlStringList(values: string[]) {
    return values.map(sqlString).join(", ")
}

function bboxForRadius(latitude: number, longitude: number, radiusMeters: number) {
    const latDelta = radiusMeters / 111_320
    const lonDelta = radiusMeters / (111_320 * Math.cos(latitude * Math.PI / 180))
    return {
        minLat: latitude - latDelta,
        maxLat: latitude + latDelta,
        minLon: longitude - lonDelta,
        maxLon: longitude + lonDelta,
    }
}

function normaliseDuckValue(value: unknown): unknown {
    if (typeof value === "bigint") return value.toString()
    if (Array.isArray(value)) return value.map(normaliseDuckValue)
    if (value && typeof value === "object") {
        return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, normaliseDuckValue(nested)]))
    }
    return value
}

function stringArray(value: unknown) {
    return Array.isArray(value) ? value.map((item) => typeof item === "string" ? item : null).filter((item): item is string => Boolean(item)) : []
}

function firstString(value: unknown) {
    const values = stringArray(value)
    return values[0] ?? null
}

function objectValue(value: unknown) {
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function firstObject(value: unknown) {
    if (Array.isArray(value)) return objectValue(value.find((item) => item && typeof item === "object"))
    return objectValue(value)
}

export async function queryOverturePlaces({ categories, location, limit, release }: { categories: string[]; location: OvertureLocation; limit: number; release?: string | null }) {
    if (!location.latitude || !location.longitude) throw new Error("Overture requires a target location with latitude and longitude.")
    if (categories.length === 0) throw new Error("Overture requires at least one mapped category.")

    const { minLat, maxLat, minLon, maxLon } = bboxForRadius(location.latitude, location.longitude, Math.min(40_000, Math.max(1_000, location.radiusMeters ?? 24_000)))
    const safeRelease = (release || DEFAULT_RELEASE).replace(/[^0-9.\-]/g, "") || DEFAULT_RELEASE
    const safeLimit = Math.min(500, Math.max(1, limit))
    const categoryList = sqlStringList(categories)
    const alternateCategoryPredicate = categories.map((category) => `list_contains(categories.alternate, ${sqlString(category)})`).join(" OR ")
    const dataset = `s3://overturemaps-us-west-2/release/${safeRelease}/theme=places/type=place/*`
    const sql = `
        select
            id,
            names.primary as name,
            websites as websites,
            phones as phones,
            addresses as addresses,
            categories.primary as primary_category,
            categories.alternate as alternate_categories,
            bbox.ymin as latitude,
            bbox.xmin as longitude
        from read_parquet(${sqlString(dataset)}, hive_partitioning=1)
        where bbox.xmin between ${minLon} and ${maxLon}
          and bbox.ymin between ${minLat} and ${maxLat}
          and (
            categories.primary in (${categoryList})
            ${alternateCategoryPredicate ? `or ${alternateCategoryPredicate}` : ""}
          )
        limit ${safeLimit}
    `

    const { DuckDBConnection } = await import("@duckdb/node-api")
    const connection = await DuckDBConnection.create()
    try {
        await connection.run("set extension_directory='/tmp/duckdb_extensions';")
        await connection.run("install httpfs;")
        await connection.run("load httpfs;")
        await connection.run("set s3_region='us-west-2';")
        const reader = await connection.runAndReadAll(sql)
        const rows = reader.getRowObjectsJson() as Record<string, unknown>[]
        return rows.map((row) => {
            const normalised = normaliseDuckValue(row) as Record<string, unknown>
            const primaryCategory = typeof normalised.primary_category === "string" ? normalised.primary_category : null
            const alternateCategories = stringArray(normalised.alternate_categories)
            return {
                id: String(normalised.id),
                name: typeof normalised.name === "string" ? normalised.name : null,
                phone: firstString(normalised.phones),
                website_url: firstString(normalised.websites),
                address: firstObject(normalised.addresses),
                latitude: typeof normalised.latitude === "number" ? normalised.latitude : null,
                longitude: typeof normalised.longitude === "number" ? normalised.longitude : null,
                categories: [
                    primaryCategory ? { key: "primary", value: primaryCategory } : null,
                    ...alternateCategories.map((category) => ({ key: "alternate", value: category })),
                ].filter((category): category is { key: string; value: string } => Boolean(category)),
                raw_payload: normalised,
            } satisfies OverturePlaceRecord
        })
    } finally {
        connection.closeSync()
    }
}
