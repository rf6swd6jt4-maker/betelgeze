import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"

export const repositoryRoot = fileURLToPath(new URL("../", import.meta.url))
const require = createRequire(import.meta.url)
let modulePath
try {
    modulePath = require.resolve("@electric-sql/pglite", {
        paths: process.env.BE_PGLITE_ROOT ? [process.env.BE_PGLITE_ROOT] : [repositoryRoot],
    })
} catch {
    throw new Error("Install optional @electric-sql/pglite@0.5.8 in a temporary directory, then set BE_PGLITE_ROOT to that directory. See docs/workspace-performance-command-operations.md.")
}
export const { PGlite } = require(modulePath)
