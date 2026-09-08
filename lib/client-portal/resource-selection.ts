export type FolderEntry = { path: string; file?: File }
export type ResourceSelection = { name: string; type: string; size: number; file?: File; entries?: FolderEntry[] }
const safeSegment = (name: string) => name.replace(/[\\/\0]/g, "_").replace(/^\.{1,2}$/, "_") || "Untitled"

export function fileSelection(file: File): ResourceSelection {
    return { name: file.name, type: file.type, size: file.size, file }
}

export function resourceSelectionHasFiles(selection: ResourceSelection) {
    // A zero-byte file is still a file; a tree containing only directories is empty.
    return Boolean(selection.file || selection.entries?.some((entry) => entry.file))
}

export function folderSelection(name: string, entries: FolderEntry[]): ResourceSelection {
    const aliases = new Map<string, string>()
    const siblings = new Map<string, Set<string>>()
    entries = entries.map((entry) => {
        const parts = entry.path.split("/").filter(Boolean)
        const path = parts.map((part, index) => {
            const key = JSON.stringify(parts.slice(0, index + 1))
            if (aliases.has(key)) return aliases.get(key)!
            const parent = JSON.stringify(parts.slice(0, index))
            const used = siblings.get(parent) ?? new Set<string>()
            const base = safeSegment(part)
            let candidate = base
            for (let suffix = 2; used.has(candidate); suffix++) candidate = `${base} (${suffix})`
            used.add(candidate)
            siblings.set(parent, used)
            aliases.set(key, candidate)
            return candidate
        }).join("/")
        return { ...entry, path: `${path}${entry.file ? "" : "/"}` }
    })
    // STORE preserves original bytes. Reserve more than ZIP64's headers/paths need.
    const encoder = new TextEncoder()
    const size = entries.reduce((total, entry) => total + (entry.file?.size ?? 0) + encoder.encode(entry.path).byteLength * 2 + 4096, 1024 ** 2)
    return { name: `${name}.zip`, type: "application/zip", size, entries }
}

export function selectedFolders(files: File[]): ResourceSelection[] {
    const folders = new Map<string, FolderEntry[]>()
    for (const file of files) {
        const parts = (file.webkitRelativePath || file.name).split("/")
        const root = parts.length > 1 ? parts[0] : "Folder"
        const entries = folders.get(root) ?? []
        entries.push({ path: parts.length > 1 ? parts.join("/") : `${root}/${parts[0]}`, file })
        folders.set(root, entries)
    }
    return [...folders].map(([name, entries]) => folderSelection(name, entries))
}

async function readEntry(entry: FileSystemEntry, path: string, entries: FolderEntry[]) {
    if (entry.isFile) {
        const file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject))
        entries.push({ path, file })
    } else if (entry.isDirectory) {
        entries.push({ path: `${path}/` })
        const reader = (entry as FileSystemDirectoryEntry).createReader()
        // Chromium returns at most 100 entries per call; keep reading until empty.
        while (true) {
            const children = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject))
            if (!children.length) break
            for (const child of children) await readEntry(child, `${path}/${child.name}`, entries)
        }
    }
}

export async function droppedResources(transfer: DataTransfer) {
    // Read the drop's protected data store before the first await.
    const roots = Array.from(transfer.items).filter((item) => item.kind === "file").map((item) => ({ entry: item.webkitGetAsEntry?.(), file: item.getAsFile() }))
    if (!roots.length) return { selections: Array.from(transfer.files).map(fileSelection), failures: [] as string[] }
    const selections: ResourceSelection[] = []
    const failures: string[] = []
    for (const root of roots) {
        try {
            if (root.entry?.isDirectory) {
                const entries: FolderEntry[] = []
                await readEntry(root.entry, root.entry.name, entries)
                selections.push(folderSelection(root.entry.name, entries))
            } else if (root.file) selections.push(fileSelection(root.file))
        } catch { failures.push(root.entry?.name || root.file?.name || "Folder") }
    }
    return { selections, failures }
}

export async function folderArchive(entries: FolderEntry[], signal: AbortSignal) {
    const { ZipWriter } = await import("@zip.js/zip.js/lib/zip-core-writer.js")
    let controller!: TransformStreamDefaultController<Uint8Array>
    const stream = new TransformStream<Uint8Array, Uint8Array>({ start(value) { controller = value } })
    const writer = new ZipWriter(stream.writable, { level: 0, zip64: true, bufferedWrite: false, useWebWorkers: false, signal })
    const completion = (async () => {
        try {
            for (const entry of entries) {
                signal.throwIfAborted()
                await writer.add(entry.path, entry.file?.stream(), { directory: !entry.file, uncompressedSize: entry.file?.size, lastModDate: entry.file ? new Date(entry.file.lastModified) : undefined })
            }
            await writer.close()
        } catch (error) { controller.error(error); throw error }
    })()
    // The consumer also awaits completion; avoid an unhandled rejection while it uploads a part.
    void completion.catch(() => {})
    return { readable: stream.readable, completion }
}
