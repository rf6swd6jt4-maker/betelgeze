import { DetailField, DetailFields } from "@/components/detail"
import { billingCadence, serviceMoney, type ServicePricing } from "@/lib/service-pricing"

/** One payment vocabulary for catalogue defaults, negotiated quotes and frozen sales. No reads or effects. */
export function ServicePriceSummary({ pricing, surface = "dark", estimate = false }: { pricing: ServicePricing; surface?: "dark" | "light"; estimate?: boolean }) {
    const recurring = pricing.recurringCents > 0
    const cadence = billingCadence(pricing.billingInterval, pricing.billingIntervalCount)
    return <section aria-label={estimate ? "Default payment breakdown" : "Payment breakdown"} className="min-w-0">
        <DetailFields columns={1} surface={surface}>
            <DetailField stackOnMobile label={recurring ? "Additional one-time fee" : "One-time fee"} icon="status">{serviceMoney(pricing.upfrontCents, pricing.currency)}</DetailField>
            {recurring ? <DetailField stackOnMobile label="First recurring payment" icon="schedule">{serviceMoney(pricing.recurringCents, pricing.currency)} at checkout</DetailField> : null}
            <DetailField stackOnMobile label="Due at checkout" icon="status"><strong className="text-lg">{serviceMoney(pricing.upfrontCents + pricing.recurringCents, pricing.currency)} {pricing.currency.toUpperCase()}</strong></DetailField>
            <DetailField stackOnMobile label="After checkout" icon="schedule">{recurring ? `${serviceMoney(pricing.recurringCents, pricing.currency)} ${cadence}` : "No recurring payments"}</DetailField>
        </DetailFields>
        <p className={`mt-3 text-sm leading-6 ${surface === "light" ? "text-[var(--onboarding-muted,#475569)]" : "text-neutral-400"}`}>
            {recurring ? `The subscription starts when you complete checkout. The first recurring payment and any additional one-time fee are charged together. Recurring payments then repeat ${cadence}, starting one full billing period later.` : "The full one-time amount is charged at checkout."}
            {estimate ? " These defaults can be adjusted in the POS before the sale is saved." : ""}
        </p>
    </section>
}
