export function devicePlatform(agent: string | null) {
    const ua = agent ?? ""
    const platform = /iphone|ipod/i.test(ua) ? "iPhone" : /ipad/i.test(ua) ? "iPad" : /android/i.test(ua) ? "Android" : /windows/i.test(ua) ? "Windows" : /cros/i.test(ua) ? "ChromeOS" : /macintosh|mac os/i.test(ua) ? "macOS" : /linux/i.test(ua) ? "Linux" : "Unknown platform"
    const browser = /edg(e|a|ios)?\//i.test(ua) ? "Edge" : /firefox|fxios/i.test(ua) ? "Firefox" : /chrome|crios/i.test(ua) ? "Chrome" : /safari/i.test(ua) ? "Safari" : "Browser"
    return { platform, browser, mobile: /iphone|ipad|ipod|android|mobile/i.test(ua) }
}
