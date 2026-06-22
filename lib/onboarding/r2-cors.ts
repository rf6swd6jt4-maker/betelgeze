import { getRequiredEnv } from "@/lib/env"

type CorsRule = {
    id?: string
    allowed?: { origins?: string[]; methods?: string[]; headers?: string[] }
    exposeHeaders?: string[]
    maxAgeSeconds?: number
}

export async function allowDirectUploadsFromDomain(domain: string) {
    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim() || getRequiredEnv("R2_ACCOUNT_ID")
    const token = getRequiredEnv("CLOUDFLARE_API_TOKEN")
    const bucket = getRequiredEnv("R2_BUCKET_NAME")
    const endpoint = `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets/${encodeURIComponent(bucket)}/cors`
    const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }
    const current = await fetch(endpoint, { headers, cache: "no-store" })
    if (!current.ok) throw new Error("Could not read the R2 upload CORS policy.")
    const body = await current.json() as { result?: { rules?: CorsRule[] } }
    const id = `betelgeze-onboarding-${domain}`
    const rules = (body.result?.rules ?? []).filter((rule) => rule.id !== id)
    rules.push({
        id,
        allowed: { origins: [`https://${domain}`], methods: ["PUT"], headers: ["content-type"] },
        exposeHeaders: ["ETag"],
        maxAgeSeconds: 3600,
    })
    const saved = await fetch(endpoint, { method: "PUT", headers, body: JSON.stringify({ rules }), cache: "no-store" })
    if (!saved.ok) throw new Error("Could not allow browser uploads from this custom domain.")
}
