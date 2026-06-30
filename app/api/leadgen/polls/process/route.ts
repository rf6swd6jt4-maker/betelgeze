import { NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { processLeadgenPoll } from "@/lib/leadgen/poll-runner"

export const dynamic = "force-dynamic"
export const maxDuration = 300

const STALE_RUNNING_POLL_MS = 8 * 60 * 1000

function runningPollIsStale(startedAt: string | null | undefined) {
    if (!startedAt) return true
    const started = new Date(startedAt).getTime()
    return !Number.isFinite(started) || Date.now() - started > STALE_RUNNING_POLL_MS
}

export async function POST(request: Request) {
    const supabase = await createSupabaseServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 })

    const url = new URL(request.url)
    const workspaceSlug = url.searchParams.get("workspace")
    if (!workspaceSlug) return NextResponse.json({ error: "Missing workspace" }, { status: 400 })

    const workspaceResult = await supabaseAdmin
        .from("workspaces")
        .select("id, status")
        .eq("slug", workspaceSlug)
        .maybeSingle()
    const workspace = workspaceResult.data
    if (!workspace || workspace.status !== "active") return NextResponse.json({ error: "Workspace not found" }, { status: 404 })

    const membershipResult = await supabaseAdmin
        .from("workspace_memberships")
        .select("role")
        .eq("workspace_id", workspace.id)
        .eq("user_id", user.id)
        .maybeSingle()
    if (!membershipResult.data) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

    const runningResult = await supabaseAdmin
        .from("leadgen_polls")
        .select("id, started_at")
        .eq("workspace_id", workspace.id)
        .eq("status", "running")
        .limit(1)
        .maybeSingle()
    if (runningResult.data?.id) {
        if (!runningPollIsStale(runningResult.data.started_at)) return NextResponse.json({ status: "already_running", pollId: runningResult.data.id })
        await processLeadgenPoll({ workspaceId: workspace.id, pollId: runningResult.data.id })
        return NextResponse.json({ status: "resumed_stale_running", pollId: runningResult.data.id })
    }

    const queuedResult = await supabaseAdmin
        .from("leadgen_polls")
        .select("id")
        .eq("workspace_id", workspace.id)
        .eq("status", "queued")
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle()
    const queuedPoll = queuedResult.data
    if (!queuedPoll?.id) return NextResponse.json({ status: "idle" })

    await processLeadgenPoll({ workspaceId: workspace.id, pollId: queuedPoll.id })
    return NextResponse.json({ status: "processed", pollId: queuedPoll.id })
}
