export type OfflineKind = "native" | "client"
export type OfflineChat = {
  key: string; userId: string; workspaceId: string; workspaceSlug: string; kind: OfflineKind;
  conversationId: string; title: string; canSend: boolean; savedAt: number;
  messages: Array<{ id: string; clientRequestId: string | null; body: string; sender: string; own: boolean; createdAt: string; attachmentName?: string }>;
}
export type OfflineMessage = {
  key: string; id: string; userId: string; workspaceId: string; workspaceSlug: string; kind: OfflineKind;
  conversationId: string; title: string; payload: Record<string, unknown>; optimistic: Record<string, unknown>;
  createdAt: string; state: "queued" | "sending" | "blocked" | "sent"; attempts: number; nextAttemptAt: number;
  leaseUntil: number; error?: string | null; message?: Record<string, unknown> | null; completedAt?: number | null;
}
export type OfflineMessageInput = Omit<OfflineMessage, "key" | "state" | "attempts" | "nextAttemptAt" | "leaseUntil">
export function subscribeOffline(callback: (type: string) => void): () => void
export function offlineAccount(): Promise<{ userId: string; checkedAt: number } | null>
export function activateOfflineAccount(userId: string): Promise<void>
export function clearOfflineData(): Promise<void>
export function chatKey(userId: string, workspaceId: string, kind: OfflineKind, conversationId: string): string
export function cacheOfflineChats(userId: string, workspaceId: string, kind: OfflineKind, chats: OfflineChat[]): Promise<void>
export function readOfflineChats(userId: string): Promise<OfflineChat[]>
export function enqueueOfflineMessage(entry: OfflineMessageInput): Promise<OfflineMessage>
export function readOfflineOutbox(userId: string): Promise<OfflineMessage[]>
export function cancelOfflineMessage(id: string): Promise<unknown>
export function retryOfflineMessage(id: string): Promise<unknown>
export function deliveryOutcome(status: number, result: unknown): "sent" | "blocked" | "queued"
export function deliverOfflineMessage(id: string): Promise<void>
export function flushOfflineOutbox(userId: string, force?: boolean): Promise<void>
export function startOfflineRecovery(userId: string): () => void
