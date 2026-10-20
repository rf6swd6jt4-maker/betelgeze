import { createHash, randomBytes } from "node:crypto"

/** No grant, code, state, client identity or provider body leaves this response. */
export function ghlPopupResponse(state: string, ok: boolean) {
    const nonce = randomBytes(18).toString("base64")
    const channel = createHash("sha256").update(state).digest("hex")
    const script = `history.replaceState(null,"",location.pathname);document.querySelector("button").onclick=()=>window.close();if(typeof BroadcastChannel!=="undefined"){const channel=new BroadcastChannel("be-ghl:${channel}");channel.onmessage=e=>{if(e.data?.type==="received"){channel.close();window.close();}};channel.postMessage({type:"complete",ok:${ok}});setTimeout(()=>channel.close(),60000);}`
    return new Response(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>HighLevel authorization</title></head><body style="background:#171717;color:white;font:16px system-ui;padding:40px"><main><h1>${ok ? "Authorisation received" : "Authorisation needs attention"}</h1><p>Return to your original Betelgeze window to continue setup. This window closes when that dialog receives the result.</p><button>Close this window</button></main><script nonce="${nonce}">${script}</script></body></html>`, { status: ok ? 200 : 400, headers: {
        "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer",
        "Content-Security-Policy": `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'`,
    } })
}
