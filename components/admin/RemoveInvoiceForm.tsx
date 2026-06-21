"use client"

export function RemoveInvoiceForm({ action }: { action: () => void }) {
    return (
        <form
            action={action}
            onSubmit={(event) => {
                if (!window.confirm("Remove this invoice from Betelgeze? This cannot be undone. The Stripe invoice and payment records will remain in Stripe.")) event.preventDefault()
            }}
        >
            <button className="rounded-lg border border-red-900/80 px-3 py-2 text-center text-xs font-medium text-red-300 hover:bg-red-950/40">
                Remove invoice
            </button>
        </form>
    )
}
