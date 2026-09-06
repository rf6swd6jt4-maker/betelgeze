export function GoogleAdsLogo({ className = "h-5 w-5" }: { className?: string }) {
    return <svg viewBox="0 0 300 300" aria-hidden="true" className={`shrink-0 ${className}`}>
        <path d="M150 54 38 247" stroke="#fbbc04" strokeWidth="76" strokeLinecap="round" />
        <path d="M150 54 262 247" stroke="#4285f4" strokeWidth="76" strokeLinecap="round" />
        <circle cx="38" cy="247" r="38" fill="#34a853" />
    </svg>
}
