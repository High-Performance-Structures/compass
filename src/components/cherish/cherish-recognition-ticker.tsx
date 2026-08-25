"use client"

import type * as React from "react"

import type { FieldCherishRecognition } from "@/lib/field/types"

export function CherishRecognitionTicker({
  items,
  className,
}: {
  readonly items: readonly FieldCherishRecognition[]
  readonly className?: string
}): React.ReactElement | null {
  if (items.length === 0) return null

  return (
    <section
      className={`cherish-recognition-marquee flex min-w-0 items-center gap-4 border-y bg-muted/20 py-2.5${className ? ` ${className}` : ""}`}
      aria-label="CHERISH team recognition"
    >
      <div className="flex shrink-0 items-center gap-2 border-r px-3 sm:px-4">
        <span className="text-xs font-semibold uppercase tracking-wide">
          CHERISH
        </span>
      </div>
      <div className="min-w-0 flex-1 overflow-hidden">
        <div
          className={`flex w-max items-center gap-8 pr-8${items.length > 1 ? " cherish-recognition-track" : ""}`}
        >
          {items.map((item) => (
            <p key={item.id} className="max-w-[42rem] shrink-0 text-sm">
              <strong className="mr-2 text-xs uppercase tracking-wide text-[var(--department-primary)]">
                {item.cherishValue}
              </strong>
              {item.message}
              <span className="ml-2 text-xs text-muted-foreground">
                — {item.submittedByName ?? "Team member"}
              </span>
            </p>
          ))}
        </div>
      </div>
    </section>
  )
}
