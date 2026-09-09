import { offlineAccount, readOfflineChats, readOfflineOutbox, enqueueOfflineMessage, cancelOfflineMessage, retryOfflineMessage, flushOfflineOutbox, startOfflineRecovery, subscribeOffline, clearOfflineData } from "/offline-store.js";

const element = (id) => document.getElementById(id);
const picker = element("conversations");
const draft = element("draft");
const messages = element("messages");
let account;
let chats = [];
let entries = [];
let current;
let busy = false;
let checking = false;
let stopRecovery;
const draftKey = () => current ? `betelgeze:${current.kind === "native" ? "native-chat" : "communications"}:draft:${account.userId}:${current.workspaceId}:${current.conversationId}` : "";
const notice = (text) => { element("notice").textContent = text; };
// A failed document request can also happen inside an existing workspace tab.
// Complete its normal bridge handshake so the host removes its loading cover.
const tabId = new URL(location.href).searchParams.get("__betelgeze_tab");
if (tabId && window.parent !== window) {
  const announce = () => {
    const base = { source: "betelgeze-workspace-tabs", target: "host", tabId };
    window.parent.postMessage({ ...base, type: "location", url: `${location.pathname}${location.search}` }, location.origin);
    window.parent.postMessage({ ...base, type: "context-status", contextSupported: false }, location.origin);
  };
  window.addEventListener("message", (event) => {
    const message = event.data;
    if (event.source !== window.parent || event.origin !== location.origin || message?.source !== "betelgeze-workspace-tabs" || message.target !== "frame" || message.tabId !== tabId) return;
    if (message.type === "probe") announce();
    if ((message.type === "navigate" || message.type === "traverse") && typeof message.url === "string") {
      const destination = new URL(message.url, location.href);
      if (destination.origin === location.origin) { destination.searchParams.set("__betelgeze_tab", tabId); location.assign(destination.href); }
    }
  });
  element("return").target = "_top";
  announce();
}
const node = (tag, text, className) => {
  const result = document.createElement(tag);
  result.textContent = text;
  if (className) result.className = className;
  return result;
};

function renderMessages() {
  const nearBottom = messages.scrollHeight - messages.clientHeight - messages.scrollTop < 100;
  const scrollTop = messages.scrollTop;
  const fragment = document.createDocumentFragment();
  const pending = entries.filter((item) => item.conversationId === current?.conversationId && item.workspaceId === current.workspaceId && item.kind === current.kind && (item.state !== "sent" || item.completedAt > current.savedAt));
  const acknowledged = new Set(pending.filter((item) => item.state === "sent").map((item) => item.id));
  const rows = [...(current?.messages || []).filter((message) => !acknowledged.has(message.clientRequestId)), ...pending.map((item) => ({
    id: item.id, body: item.state === "sent" ? item.message?.body || item.payload.body || "" : item.payload.body || "",
    sender: "You", own: true, createdAt: item.createdAt, attachmentName: item.optimistic.attachment?.fileName,
    pending: item.state === "sent" ? null : item,
  }))].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  for (const message of rows) {
    const bubble = node("div", "", `message${message.own ? " own" : ""}`);
    bubble.append(node("div", String(message.body), "body"));
    if (message.attachmentName) bubble.append(node("div", `Attachment: ${message.attachmentName} · connect to open`, "attachment"));
    const meta = node("div", "", "meta");
    meta.append(node("span", `${message.sender} · ${new Date(message.createdAt).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}`));
    if (message.pending) {
      const item = message.pending;
      meta.append(node("span", item.error || (item.state === "sending" ? "Sending…" : item.attempts ? "Confirming delivery" : "Waiting for connection"), "pending"));
      if ((item.state === "queued" && item.attempts === 0) || item.state === "blocked") {
        const cancel = node("button", "Cancel"); cancel.type = "button";
        cancel.onclick = () => { void cancelOfflineMessage(item.id); }; meta.append(cancel);
      }
      if (item.state === "blocked") {
        const retry = node("button", "Retry"); retry.type = "button";
        retry.onclick = () => { void retryOfflineMessage(item.id).then(() => flushOfflineOutbox(account.userId)); }; meta.append(retry);
      }
    }
    bubble.append(meta); fragment.append(bubble);
  }
  if (!rows.length) fragment.append(node("p", current ? "No messages saved for this chat yet." : "Open Communications while connected to save recent chats on this device."));
  messages.replaceChildren(fragment);
  messages.scrollTop = nearBottom ? messages.scrollHeight : scrollTop;
}

async function refresh() {
  const identity = await offlineAccount();
  if (!identity || (account && identity.userId !== account.userId)) {
    chats = []; entries = []; current = undefined; draft.value = ""; draft.disabled = true; element("send").disabled = true;
    picker.replaceChildren(node("option", "No saved chats")); messages.replaceChildren();
    notice("Connect and sign in to use Betelgeze."); stopRecovery?.(); return;
  }
  account = identity;
  [chats, entries] = await Promise.all([readOfflineChats(account.userId), readOfflineOutbox(account.userId)]);
  for (const item of entries.filter((entry) => entry.state !== "sent")) {
    const key = `chat:${account.userId}:${item.workspaceId}:${item.kind}:${item.conversationId}`;
    if (!chats.some((chat) => chat.key === key)) chats.push({ key, userId: account.userId, workspaceId: item.workspaceId, workspaceSlug: item.workspaceSlug, kind: item.kind, conversationId: item.conversationId, title: item.title, canSend: false, savedAt: Date.parse(item.createdAt), messages: [] });
  }
  const key = current?.key;
  picker.replaceChildren(...chats.map((chat) => {
    const option = node("option", `${chat.workspaceSlug} · ${chat.kind === "native" ? "Team" : "Client"} · ${chat.title}`);
    option.value = chat.key; return option;
  }));
  current = chats.find((chat) => chat.key === key) || chats[0];
  if (current) {
    picker.value = current.key;
    element("freshness").textContent = `Saved ${new Date(current.savedAt).toLocaleString()} · ${current.messages.length} message${current.messages.length === 1 ? "" : "s"}`;
    draft.maxLength = current.kind === "native" ? 8000 : 4000;
    draft.disabled = !current.canSend; element("send").disabled = !current.canSend;
    if (current.key !== key) { draft.value = localStorage.getItem(draftKey()) || ""; messages.scrollTop = messages.scrollHeight; }
  } else {
    picker.append(node("option", "No saved chats")); draft.disabled = true; element("send").disabled = true;
  }
  renderMessages();
}

picker.onchange = () => {
  current = chats.find((chat) => chat.key === picker.value);
  draft.value = localStorage.getItem(draftKey()) || "";
  draft.disabled = !current?.canSend; element("send").disabled = !current?.canSend;
  draft.maxLength = current?.kind === "native" ? 8000 : 4000;
  element("freshness").textContent = `Saved ${new Date(current.savedAt).toLocaleString()} · ${current.messages.length} message${current.messages.length === 1 ? "" : "s"}`;
  renderMessages(); messages.scrollTop = messages.scrollHeight;
};
draft.oninput = () => {
  try { localStorage.setItem(draftKey(), draft.value); }
  catch { notice("Device storage is full. Keep this page open and copy your draft before leaving."); }
};
element("composer").onsubmit = async (event) => {
  event.preventDefault();
  if (busy || !current?.canSend || !draft.value.trim()) return;
  busy = true;
  const body = draft.value.trim();
  const chat = current;
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const optimistic = chat.kind === "native"
    ? { id, clientRequestId: id, conversationId: chat.conversationId, senderUserId: account.userId, senderWorkspaceRole: null, body, replyToMessageId: null, quote: null, attachment: null, createdAt, editedAt: null }
    : { id, clientRequestId: id, relationshipId: chat.conversationId, senderUserId: account.userId, body, direction: "outbound", provider: "omnichannel", status: "sending", error: null, senderKind: "staff", automationKind: null, automationLabel: null, attachment: null, providerMessageId: null, replyToProviderMessageId: null, replyToMessageId: null, createdAt, sentAt: null, deliveredAt: null, readAt: null, failedAt: null };
  try {
    await enqueueOfflineMessage({ id, userId: account.userId, workspaceId: chat.workspaceId, workspaceSlug: chat.workspaceSlug, kind: chat.kind, conversationId: chat.conversationId, title: chat.title,
      payload: { body, [chat.kind === "native" ? "conversationId" : "relationshipId"]: chat.conversationId }, optimistic, createdAt });
    if (current?.key === chat.key && draft.value.trim() === body) { draft.value = ""; localStorage.removeItem(draftKey()); }
    notice("Message saved on this device. It will send when Betelgeze can connect.");
    await refresh(); messages.scrollTop = messages.scrollHeight;
    void flushOfflineOutbox(account.userId);
  } catch { notice("Could not save this message on your device. Your draft is still here; try again."); }
  finally { busy = false; }
};

async function checkConnection() {
  if (checking || navigator.onLine === false) { element("connection").textContent = "Offline"; return; }
  checking = true;
  try {
    const response = await fetch("/api/offline/session", { cache: "no-store", signal: AbortSignal.timeout(8000) });
    if (response.status === 401) {
      element("connection").textContent = "Sign in to reconnect";
      element("return").hidden = false; element("return").textContent = "Sign in";
      return;
    }
    if (!response.ok) throw new Error();
    const identity = await response.json();
    if (account && identity.userId !== account.userId) { await clearOfflineData(); await refresh(); }
    element("connection").textContent = "Connected"; element("return").hidden = false;
    if (account) await flushOfflineOutbox(account.userId);
  } catch { element("connection").textContent = "Waiting for connection"; element("return").hidden = true; }
  finally { checking = false; }
}
element("reconnect").onclick = checkConnection;
element("clear").onclick = async () => {
  if (!confirm("Clear saved chats, drafts and unsent messages from this device?")) return;
  await clearOfflineData(); await refresh();
};
window.addEventListener("online", checkConnection);
window.addEventListener("offline", () => { element("connection").textContent = "Offline"; element("return").hidden = true; });
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") void checkConnection(); });
subscribeOffline((type) => {
  if (type === "outbox" || type === "account") void refresh().catch(() => undefined);
  if (type === "connected") { element("connection").textContent = "Connected"; element("return").hidden = false; }
  if (type === "auth") { element("connection").textContent = "Sign in to reconnect"; element("return").hidden = false; element("return").textContent = "Sign in"; }
});
try {
  await refresh();
  if (account) stopRecovery = startOfflineRecovery(account.userId);
  await checkConnection();
} catch { notice("Offline storage is unavailable on this device. Connect to open Betelgeze."); }
