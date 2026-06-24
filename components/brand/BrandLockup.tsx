import Image from "next/image"
import Link from "next/link"

export function BrandLockup({ href = "https://betelgeze.com", compact = false }: { href?: string; compact?: boolean }) {
    return <Link href={href} className="inline-flex items-center gap-2 text-white"><Image src="/brand/betelgeze-logo.svg" alt="Betelgeze" width={compact ? 28 : 32} height={compact ? 28 : 32} priority /><span className={compact ? "text-base font-semibold" : "text-lg font-semibold"}>Betelgeze</span></Link>
}
