// Browser storage can be denied or full. Text editing must remain usable then;
// durable sends separately confirm storage before clearing the composer.
export function readChatDraft(key: string) {
    try { return localStorage.getItem(key) ?? "" } catch { return "" }
}

export function writeChatDraft(key: string, draft: string) {
    try {
        if (draft) localStorage.setItem(key, draft)
        else localStorage.removeItem(key)
    } catch { /* Keep the live draft; the send path checks durable storage. */ }
}
