"use client"

type CopyLinkButtonProps = {
    url: string
}

export function CopyLinkButton({ url }: CopyLinkButtonProps) {
    async function copyLink() {
        await navigator.clipboard.writeText(url)
        alert("Onboarding link copied.")
    }

    return (
        <button
            type="button"
            onClick={copyLink}
            className="rounded-xl border border-neutral-700 px-4 py-3 text-sm font-medium text-white"
        >
            Copy onboarding link
        </button>
    )
}