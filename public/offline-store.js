// Shared by the normal app and the network-independent recovery document.
// Only explicitly selected data is stored. Authenticated HTML and API responses
// are never put in the service worker's HTTP cache.
const DB_NAME = "betelgeze-offline-v1";
const CHAT_TTL = 7 * 24 * 60 * 60 * 1000;
const ACK_TTL = 24 * 60 * 60 * 1000;
const listeners = new Set();
let channel;
let database;
let flushing;

function notify(type) {
  for (const listener of listeners) listener(type);
  channel?.postMessage(type);
}

export function subscribeOffline(listener) {
  if (!channel && typeof BroadcastChannel !== "undefined") {
    channel = new BroadcastChannel(DB_NAME);
    channel.onmessage = (event) => { for (const callback of listeners) callback(event.data); };
  }
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function openDatabase() {
  if (!database) database = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore("records", { keyPath: "key" });
    request.onsuccess = () => {
      request.result.onversionchange = () => { request.result.close(); database = undefined; };
      resolve(request.result);
    };
    request.onerror = () => { database = undefined; reject(request.error); };
  });
  return database;
}

async function transaction(mode, operation) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("records", mode);
    let result;
    tx.oncomplete = () => resolve(result);
    tx.onerror = tx.onabort = () => reject(tx.error || new Error("Device storage is unavailable."));
    try { operation(tx.objectStore("records"), (value) => { result = value; }); }
    catch (error) { tx.abort(); reject(error); }
  });
}

export async function offlineRecords(prefix) {
  return transaction("readonly", (store, done) => {
    const request = store.getAll(IDBKeyRange.bound(prefix, `${prefix}\uffff`));
    request.onsuccess = () => done(request.result);
  });
}

export async function offlineAccount() {
  return (await offlineRecords("account"))[0] || null;
}

function clearDraftStorage() {
  try {
    if (typeof localStorage === "undefined") return;
    for (const key of Object.keys(localStorage)) {
      if (/^betelgeze:(?:native-chat:draft:|communications:draft:|appointment-draft:|offline-draft:)/.test(key)) localStorage.removeItem(key);
    }
  } catch { /* A denied localStorage must not prevent clearing IndexedDB. */ }
}

export async function clearOfflineData() {
  clearDraftStorage();
  await transaction("readwrite", (store) => store.clear());
  notify("account");
}

// Called only with an identity supplied by an authenticated server render.
export async function activateOfflineAccount(userId) {
  await transaction("readwrite", (store) => {
    const request = store.get("account");
    request.onsuccess = () => {
      if (request.result && request.result.userId !== userId) { store.clear(); clearDraftStorage(); }
      store.put({ key: "account", userId, checkedAt: Date.now() });
      const old = store.getAll(IDBKeyRange.bound("outbox:", "outbox:\uffff"));
      old.onsuccess = () => { for (const item of old.result) if (item.state === "sent" && item.completedAt < Date.now() - ACK_TTL) store.delete(item.key); };
    };
  });
}

export function chatKey(userId, workspaceId, kind, conversationId) {
  return `chat:${userId}:${workspaceId}:${kind}:${conversationId}`;
}

export async function cacheOfflineChats(userId, workspaceId, kind, chats) {
  await transaction("readwrite", (store) => {
    const account = store.get("account");
    account.onsuccess = () => {
      if (account.result?.userId !== userId) return;
      const request = store.getAll(IDBKeyRange.bound("chat:", "chat:\uffff"));
      request.onsuccess = () => {
        const prefix = `chat:${userId}:${workspaceId}:${kind}:`;
        const incoming = new Set(chats.map((chat) => chat.key));
        for (const old of request.result) {
          if (old.savedAt < Date.now() - CHAT_TTL || (old.key.startsWith(prefix) && !incoming.has(old.key))) store.delete(old.key);
        }
        for (const chat of chats) store.put({ ...chat, savedAt: Date.now(), messages: chat.messages.slice(-100) });
        // Bound the device cache across workspaces, favouring recently used chats.
        const combined = [...request.result.filter((item) => !incoming.has(item.key) && !item.key.startsWith(prefix)), ...chats];
        combined.sort((a, b) => (b.savedAt || Date.now()) - (a.savedAt || Date.now()));
        for (const old of combined.slice(60)) store.delete(old.key);
      };
    };
  });
}

export async function readOfflineChats(userId) {
  return (await offlineRecords(`chat:${userId}:`)).filter((chat) => chat.savedAt >= Date.now() - CHAT_TTL);
}

export async function enqueueOfflineMessage(entry) {
  const item = { ...entry, key: `outbox:${entry.id}`, state: "queued", attempts: 0, nextAttemptAt: 0, leaseUntil: 0, createdAt: entry.createdAt || new Date().toISOString() };
  await transaction("readwrite", (store, done) => {
    const account = store.get("account");
    account.onsuccess = () => {
      if (account.result?.userId !== entry.userId) { done(false); return; }
      const existing = store.get(item.key);
      existing.onsuccess = () => {
        // A repeated click/retry retains the original durable request identity.
        if (!existing.result || (existing.result.state === "sent" && entry.payload.retry === true)) store.put(item);
        done(true);
      };
    };
  }).then((stored) => { if (!stored) throw new Error("Sign in again before saving this message."); });
  notify("outbox");
  return item;
}

export async function readOfflineOutbox(userId) {
  return (await offlineRecords("outbox:")).filter((item) => item.userId === userId && (item.state !== "sent" || item.completedAt > Date.now() - ACK_TTL));
}

async function updateEntry(id, update) {
  const result = await transaction("readwrite", (store, done) => {
    const request = store.get(`outbox:${id}`);
    request.onsuccess = () => {
      if (!request.result) return;
      const next = update(request.result);
      if (next) store.put(next);
      else store.delete(request.result.key);
      done(next);
    };
  });
  notify("outbox");
  return result;
}

export async function cancelOfflineMessage(id) {
  return updateEntry(id, (item) => (item.attempts === 0 && item.state === "queued") || item.state === "blocked" ? null : item);
}

export async function retryOfflineMessage(id) {
  return updateEntry(id, (item) => item.state === "blocked" ? { ...item, state: "queued", error: null, nextAttemptAt: 0, leaseUntil: 0 } : item);
}

export function deliveryOutcome(status, result) {
  if (status >= 200 && status < 300 && typeof result?.message?.id === "string" && typeof result.message.clientRequestId === "string") return "sent";
  if (status === 401 || status === 403 || (status >= 400 && status < 500 && ![408, 429].includes(status))) return "blocked";
  return "queued";
}

// Transactional lease prevents concurrent tabs/frames from posting one item.
// Reusing the request ID also protects a retry after a lost response or crash.
export async function deliverOfflineMessage(id) {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return;
  const lease = crypto.randomUUID();
  const item = await transaction("readwrite", (store, done) => {
    const request = store.get(`outbox:${id}`);
    request.onsuccess = () => {
      const item = request.result;
      if (!item || item.state === "sent" || item.state === "blocked" || item.leaseUntil > Date.now() || item.nextAttemptAt > Date.now()) return;
      const account = store.get("account");
      account.onsuccess = () => {
        if (account.result?.userId !== item.userId) return;
        const previous = store.getAll(IDBKeyRange.bound("outbox:", "outbox:\uffff"));
        previous.onsuccess = () => {
          const waiting = previous.result.some((other) => other.id !== item.id && other.userId === item.userId && other.workspaceId === item.workspaceId && other.kind === item.kind && other.conversationId === item.conversationId && (other.state === "queued" || other.state === "sending") && other.createdAt < item.createdAt);
          if (waiting) return;
          const claimed = { ...item, state: "sending", lease, leaseUntil: Date.now() + 45_000, attempts: item.attempts + 1 };
          store.put(claimed); done(claimed);
        };
      };
    };
  });
  if (!item) return;
  notify("outbox");
  let status = 0;
  let result = null;
  try {
    const response = await fetch(`/api/workspaces/${encodeURIComponent(item.workspaceSlug)}/communications/${item.kind === "native" ? "native/" : ""}messages`, {
      method: "POST", credentials: "same-origin", redirect: "error",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...item.payload, clientRequestId: item.id, offlineUserId: item.userId, offlineWorkspaceId: item.workspaceId }),
      signal: AbortSignal.timeout(25_000),
    });
    status = response.status;
    result = await response.json().catch(() => null);
  } catch { /* Keep the durable request until a server acknowledgement arrives. */ }
  const outcome = deliveryOutcome(status, result);
  const state = outcome === "sent" && result.message.clientRequestId !== id ? "queued" : outcome;
  await updateEntry(id, (current) => {
    if (current.lease !== lease) return current;
    return { ...current, state, leaseUntil: 0, completedAt: state === "sent" ? Date.now() : null,
      message: state === "sent" ? result.message : null,
      error: state === "blocked" ? result?.error || "This message needs attention before it can be sent." : null,
      nextAttemptAt: state === "queued" ? Date.now() + Math.min(30_000, 1000 * 2 ** Math.min(current.attempts, 5)) : 0 };
  });
  if (state === "sent") void flushOfflineOutbox(item.userId);
}

export async function flushOfflineOutbox(userId, force = false) {
  if (flushing) return flushing;
  flushing = (async () => {
    if (navigator.onLine === false) return;
    const items = (await readOfflineOutbox(userId)).filter((item) => item.state === "queued" || (item.state === "sending" && item.leaseUntil <= Date.now()));
    if (!items.length) return;
    // Only queued recovery adds this request; ordinary online sends go straight
    // to their existing endpoint, which verifies offlineUserId and permissions.
    const response = await fetch("/api/offline/session", { cache: "no-store", credentials: "same-origin", signal: AbortSignal.timeout(10_000) });
    if (!response.ok) { if (response.status === 401) notify("auth"); return; }
    const session = await response.json();
    if (session.userId !== userId) { await clearOfflineData(); return; }
    notify("connected");
    const paused = new Set();
    for (const item of items.sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
      const scope = `${item.workspaceId}:${item.kind}:${item.conversationId}`;
      if (paused.has(scope)) continue;
      if (force) await updateEntry(item.id, (current) => ({ ...current, nextAttemptAt: 0 }));
      await deliverOfflineMessage(item.id);
      // Preserve the order of messages within a conversation after interruption.
      const pending = (await readOfflineOutbox(userId)).find((candidate) => candidate.id === item.id);
      if (pending && pending.state !== "sent") paused.add(scope);
    }
  })().catch(() => undefined).finally(() => { flushing = undefined; });
  return flushing;
}

export function startOfflineRecovery(userId) {
  let stopped = false;
  const recover = () => { if (!stopped && document.visibilityState === "visible") void flushOfflineOutbox(userId, true); };
  window.addEventListener("online", recover);
  window.addEventListener("focus", recover);
  document.addEventListener("visibilitychange", recover);
  const timer = window.setInterval(() => { if (!stopped && document.visibilityState === "visible") void flushOfflineOutbox(userId); }, 15_000);
  recover();
  return () => {
    stopped = true; clearInterval(timer);
    window.removeEventListener("online", recover);
    window.removeEventListener("focus", recover);
    document.removeEventListener("visibilitychange", recover);
  };
}
