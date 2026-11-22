import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { nativeConversationUnreadCount } from "../lib/communications/unread.ts"
import { communicationsModeFromQuery } from "../lib/communications/mode-resource.ts"
import { communicationsLocation } from "../lib/communications/native-host.ts"
import { leadsCommsEnabled } from "../lib/campaigns/pilot.ts"

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
const at = (second: number) => `2026-11-22T15:00:${String(second).padStart(2, "0")}.000000Z`

test("a lead conversation counts only the lead's own texts, never a teammate's", () => {
    const messages = [
        { id: "m1", createdAt: at(1), senderUserId: "be" },       // the lead's text (no staff sender)
        { id: "m2", createdAt: at(2), senderUserId: "teammate" }, // a teammate texted the lead
        { id: "m3", createdAt: at(3), senderUserId: "me" },
        { id: "m4", createdAt: at(4), senderUserId: "be" },
    ]
    assert.equal(nativeConversationUnreadCount({ kind: "lead", messages }, undefined, "me"), 2)
    assert.equal(nativeConversationUnreadCount({ kind: "lead", messages }, { lastReadMessageId: "m1", lastReadAt: at(1) }, "me"), 1)
    // Team chats keep their rule: anything not sent by me.
    assert.equal(nativeConversationUnreadCount({ kind: "team", messages }, undefined, "me"), 3)
    assert.equal(nativeConversationUnreadCount({ messages }, undefined, "me"), 3)
})

test("Comms addresses open the Leads tab only when asked for it", () => {
    const query = (value: string) => new URLSearchParams(value)
    assert.equal(communicationsModeFromQuery(query("mode=leads&nativeConversation=c")), "leads")
    assert.equal(communicationsModeFromQuery(query("nativeConversation=c")), "team")
    assert.equal(communicationsModeFromQuery(query("dm=u")), "team")
    assert.equal(communicationsModeFromQuery(query("mode=clients&nativeConversation=c")), "clients")
    assert.equal(communicationsModeFromQuery(query("")), "clients")
    assert.deepEqual(communicationsLocation("/example/communications?mode=leads&nativeConversation=lead-c", "example"), { mode: "leads", conversationId: undefined, nativeConversationId: "lead-c", dmUserId: undefined })
})

test("the Leads tab is for owners and admins with Campaigns", () => {
    assert.equal(leadsCommsEnabled("u1", "owner", "u1,u2"), true)
    assert.equal(leadsCommsEnabled("u1", "admin", "all"), true)
    assert.equal(leadsCommsEnabled("u1", "staff", "all"), false)
    assert.equal(leadsCommsEnabled("u3", "owner", "u1,u2"), false)
    assert.equal(leadsCommsEnabled(null, "owner", "all"), false)
})

test("the Leads list, its send path and Chat are gated and separate from Team", () => {
    const route = source("app/api/workspaces/[workspaceSlug]/communications/native/conversations/route.ts")
    assert.match(route, /scope === "leads" && !leadsCommsEnabled\(user\.id, role\)/)
    const teams = source("lib/teams/server.ts")
    // Team never lists lead conversations, and Leads lists nothing else.
    assert.match(teams, /\(conversation\.kind === "lead"\) !== leadsScope/)
    const messages = source("app/api/workspaces/[workspaceSlug]/communications/native/messages/route.ts")
    assert.match(messages, /sendLeadText/)
    assert.match(messages, /campaignsPilotEnabled\(user\.id\)/)
    const panel = source("components/communications/CommunicationsPanel.tsx")
    // A lead's row counts in Leads, not in Team, and in the Comms total.
    assert.match(panel, /row\.kind === "native" && row\.lead \? "lead" : row\.kind/)
    assert.match(panel, /clientUnreadCount \+ nativeUnreadCount \+ leadsUnreadCount/)
    const shell = source("components/workspace/WorkspaceTopBarClient.tsx")
    assert.match(shell, /message\.type === "lead-chat"/)
    assert.match(shell, /mode=leads&nativeConversation=/)
    // Chat starts the conversation and sends nothing.
    const actions = source("app/[workspaceSlug]/campaigns/actions.ts")
    assert.match(actions, /export async function openLeadChat[\s\S]*?ensureLeadConversation\(workspace\.id, lead\.id, user\.id\)/)
    assert.doesNotMatch(actions.slice(actions.indexOf("export async function openLeadChat")), /sendLeadText/)
})

test("the lead composer carries text only", () => {
    const workspace = source("components/communications/TeamCommunicationsWorkspace.tsx")
    assert.match(workspace, /const richActions = Boolean\(selected\?\.canWrite\) && selected\?\.kind !== "lead"/)
    const messages = source("app/api/workspaces/[workspaceSlug]/communications/native/messages/route.ts")
    const leadBranch = messages.slice(messages.indexOf("sendLeadText(") - 1200, messages.indexOf("sendLeadText(") + 400)
    assert.match(leadBranch, /attachment|upload/i)
})
