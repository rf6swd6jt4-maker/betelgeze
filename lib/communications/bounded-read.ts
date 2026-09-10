type RpcResult<T> = { data: T | null; error: { code?: string; message: string } | null }

/** Unflagged clients make exactly their existing RPC call. A flagged older
 * database can fall back only when the additive function is not installed. */
export async function loadBoundedCommunicationRows<T>(input: {
    enabled: boolean
    kind: "client" | "native"
    read: (name: string) => PromiseLike<RpcResult<T>>
}): Promise<RpcResult<T>> {
    const legacy = `communication_${input.kind}_messages`
    if (!input.enabled) return input.read(legacy)
    const result = await input.read(`${legacy}_bounded`)
    return result.error?.code === "42883" || result.error?.code === "PGRST202" ? input.read(legacy) : result
}
