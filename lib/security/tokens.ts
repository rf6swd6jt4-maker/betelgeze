export function maskToken(token: string, visibleCharacters = 6) {
    if (token.length <= visibleCharacters * 2) {
        return "••••"
    }

    return `${token.slice(0, visibleCharacters)}...${token.slice(-visibleCharacters)}`
}
