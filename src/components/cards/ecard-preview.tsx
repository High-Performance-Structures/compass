import { IconGift, IconSparkles } from "@tabler/icons-react"

import type { EcardTemplate } from "@/lib/greeting-cards/templates"

export function EcardPreview({
  template,
  recipientName,
  message,
  wishes,
  giftAmountCents,
  giftClaimUrl,
  compact = false,
}: {
  readonly template: EcardTemplate
  readonly recipientName: string
  readonly message: string
  readonly wishes: string
  readonly giftAmountCents: number | null
  readonly giftClaimUrl?: string | null
  readonly compact?: boolean
}): React.ReactElement {
  return (
    <section
      className={`overflow-hidden rounded-lg border bg-card shadow-sm ${
        compact ? "p-5" : "p-7 sm:p-10"
      }`}
      aria-label={`${template.name} e-card preview`}
    >
      <div className="border-b bg-linear-to-br from-primary/10 via-background to-accent/20 pb-6 text-center">
        <IconSparkles className="mx-auto size-7 text-primary" aria-hidden="true" />
        <p className="mt-3 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          High Performance Structures Inc.
        </p>
        <h1 className={`${compact ? "mt-3 text-2xl" : "mt-4 text-4xl sm:text-5xl"} font-semibold tracking-tight`}>
          {template.headline}
        </h1>
        {recipientName ? (
          <p className="mt-3 text-lg text-muted-foreground">{recipientName},</p>
        ) : null}
      </div>

      <div className={`mx-auto max-w-2xl ${compact ? "pt-5" : "pt-8"}`}>
        <p className="whitespace-pre-wrap text-base leading-7">
          {message || "Your message will appear here."}
        </p>
        <p className="mt-6 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
          {wishes || "Your closing will appear here."}
        </p>

        {giftAmountCents !== null ? (
          <div className="mt-8 border-t pt-6 text-center">
            <IconGift className="mx-auto size-7 text-primary" aria-hidden="true" />
            <p className="mt-3 font-semibold">
              A {formatMoney(giftAmountCents)} digital gift is included
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Choose from eligible Giftbit rewards available in the United States.
            </p>
            {giftClaimUrl ? (
              <a
                href={giftClaimUrl}
                rel="noreferrer"
                className="mt-5 inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow-xs hover:bg-primary/90"
              >
                Choose your gift
              </a>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  )
}

function formatMoney(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100)
}
