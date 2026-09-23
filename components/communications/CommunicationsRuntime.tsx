"use client"

import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { createSupabaseBrowserClient } from "@/lib/supabase/browser"

export type CommunicationsClient = Pick<SupabaseClient, "auth" | "realtime" | "channel" | "removeChannel">
type Client = CommunicationsClient
const Runtime = createContext<Client | null>(null)

/** Keep the former per-document socket ownership without introducing iframes.
 * Both modes share one client; exact private broadcast topics stay unchanged.
 */
export function CommunicationsRuntime({ children }: { children: ReactNode }) {
    const [runtime] = useState(() => {
        const shared = createSupabaseBrowserClient()
        // An explicit accessToken provider skips GoTrue construction entirely:
        // only the existing singleton owns auth cookies/listeners/refresh.
        const transport = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
            accessToken: async () => (await shared.auth.getSession()).data.session?.access_token ?? null,
        })
        const client: Client = {
            auth: shared.auth, realtime: transport.realtime,
            channel: transport.channel.bind(transport), removeChannel: transport.removeChannel.bind(transport),
        }
        return { client, transport }
    })
    const generation = useRef(0)
    useEffect(() => {
        const lifecycle = generation
        const mountedGeneration = ++lifecycle.current
        return () => {
            // React's development effect replay retains the runtime. A real
            // owner departure disposes every channel and its socket/heartbeat.
            queueMicrotask(() => { if (lifecycle.current === mountedGeneration) void runtime.transport.removeAllChannels() })
        }
    }, [runtime])
    return <Runtime.Provider value={runtime.client}>{children}</Runtime.Provider>
}

export function useCommunicationsClient() {
    const client = useContext(Runtime)
    return useMemo(() => client ?? createSupabaseBrowserClient(), [client])
}
