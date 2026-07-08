import { createReadStream, existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import path from "node:path"

import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3"

type CliOptions = {
    dir: string
    prefix: string
    dryRun: boolean
    concurrency: number
}

function loadEnvFile(filePath: string) {
    if (!existsSync(filePath)) return
    for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith("#")) continue
        const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
        if (!match) continue
        const [, key, rawValue] = match
        if (process.env[key]) continue
        process.env[key] = rawValue.replace(/^['"]|['"]$/g, "")
    }
}

function requiredEnv(name: string) {
    const value = process.env[name]
    if (!value) throw new Error(`Missing required environment variable: ${name}`)
    return value
}

function usage() {
    return [
        "Usage:",
        "  npm run upload:az-owner-shards -- --dir .az-owner-shards --prefix arizona/owner",
        "",
        "Options:",
        "  --dry-run              Print upload keys without writing to R2.",
        "  --concurrency 8        Number of parallel R2 uploads.",
    ].join("\n")
}

function parseArgs(argv: string[]): CliOptions {
    const options: CliOptions = {
        dir: ".az-owner-shards",
        prefix: process.env.AZ_OWNER_R2_PREFIX ?? "arizona/owner",
        dryRun: false,
        concurrency: 8,
    }
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index]
        if (arg === "--dir") {
            options.dir = argv[index + 1] ?? options.dir
            index += 1
        } else if (arg === "--prefix") {
            options.prefix = argv[index + 1] ?? options.prefix
            index += 1
        } else if (arg === "--dry-run") {
            options.dryRun = true
        } else if (arg === "--concurrency") {
            options.concurrency = Math.min(24, Math.max(1, Number(argv[index + 1]) || options.concurrency))
            index += 1
        }
    }
    return options
}

function r2Client() {
    return new S3Client({
        region: "auto",
        endpoint: `https://${requiredEnv("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com`,
        credentials: {
            accessKeyId: requiredEnv("R2_ACCESS_KEY_ID"),
            secretAccessKey: requiredEnv("R2_SECRET_ACCESS_KEY"),
        },
    })
}

function objectFiles(root: string): string[] {
    if (!existsSync(root)) return []
    return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
        const fullPath = path.join(root, entry.name)
        if (entry.isDirectory()) return objectFiles(fullPath)
        return entry.isFile() && entry.name.endsWith(".jsonl.gz") ? [fullPath] : []
    })
}

function objectKey(prefix: string, root: string, filePath: string) {
    const relative = path.relative(root, filePath).split(path.sep).join("/")
    return [prefix.replace(/^\/+|\/+$/g, ""), relative].filter(Boolean).join("/")
}

function formatBytes(bytes: number) {
    if (bytes < 1024) return `${bytes} B`
    const units = ["KB", "MB", "GB", "TB"]
    let value = bytes / 1024
    let unit = units.shift() ?? "KB"
    while (value >= 1024 && units.length) {
        value /= 1024
        unit = units.shift() ?? unit
    }
    return `${value.toFixed(value >= 10 ? 1 : 2)} ${unit}`
}

async function runWithConcurrency<T>(items: T[], concurrency: number, worker: (item: T, index: number) => Promise<void>) {
    let index = 0
    const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
        while (index < items.length) {
            const currentIndex = index
            index += 1
            await worker(items[currentIndex], currentIndex)
        }
    })
    await Promise.all(runners)
}

async function uploadShards(options: CliOptions) {
    const files = objectFiles(options.dir)
    if (files.length === 0) throw new Error(`No .jsonl.gz shard files found under ${options.dir}`)
    const totalBytes = files.reduce((total, file) => total + statSync(file).size, 0)
    console.log(`Uploading ${files.length.toLocaleString()} Arizona shard file${files.length === 1 ? "" : "s"} (${formatBytes(totalBytes)}) to R2 prefix ${options.prefix}...`)
    if (options.dryRun) {
        for (const file of files.slice(0, 20)) console.log(objectKey(options.prefix, options.dir, file))
        if (files.length > 20) console.log(`...${(files.length - 20).toLocaleString()} more`)
        return
    }
    const client = r2Client()
    const bucket = requiredEnv("R2_BUCKET_NAME")
    const startedAt = Date.now()
    await runWithConcurrency(files, options.concurrency, async (file, index) => {
        const key = objectKey(options.prefix, options.dir, file)
        await client.send(new PutObjectCommand({
            Bucket: bucket,
            Key: key,
            Body: createReadStream(file),
            ContentType: "application/x-ndjson; charset=utf-8",
            ContentEncoding: "gzip",
            CacheControl: "public, max-age=86400, immutable",
        }))
        if ((index + 1) % 500 === 0 || index + 1 === files.length) {
            const elapsedSeconds = Math.max(1, Math.round((Date.now() - startedAt) / 1000))
            console.log(`stage=upload progress=${(index + 1).toLocaleString()}/${files.length.toLocaleString()} elapsed=${elapsedSeconds}s`)
        }
    })
}

async function main() {
    loadEnvFile(path.join(process.cwd(), ".env.local"))
    loadEnvFile(path.join(process.cwd(), ".env"))
    const options = parseArgs(process.argv.slice(2))
    if (!existsSync(options.dir)) {
        console.error(usage())
        throw new Error(`Shard directory does not exist: ${options.dir}`)
    }
    await uploadShards(options)
}

main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
})
