"use client"

import type * as React from "react"
import { IconHeartHandshake } from "@tabler/icons-react"

import type { FieldCherishRecognition } from "@/lib/field/types"
import { cn } from "@/lib/utils"

function recognitionLabel(item: FieldCherishRecognition): string {
  return item.responseType === "win" ? "Project win" : "Shoutout"
}

function RecognitionItems({
  items,
  duplicate = false,
}: {
  readonly items: readonly FieldCherishRecognition[]
  readonly duplicate?: boolean
}): React.ReactElement {
  return (
    <div
      className="flex shrink-0 items-center gap-8 pr-8"
      aria-hidden={duplicate || undefined}
    >
      {items.map((item) => (
        <div key={item.id} className="flex max-w-[42rem] items-center gap-3">
          <span className="shrink-0 text-xs font-semibold uppercase tracking-wide text-[var(--department-primary)]">
            {item.cherishValue}
          </span>
          <span className="text-sm text-foreground">{item.message}</span>
          <span className="shrink-0 text-xs text-muted-foreground">
            {recognitionLabel(item)} · {item.submittedByName ?? "Team member"}
          </span>
        </div>
      ))}
    </div>
  )
}

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
      className={cn(
        "cherish-recognition-marquee flex min-w-0 items-center gap-4 border-y bg-muted/20 py-2.5",
        className,
      )}
      aria-label="CHERISH team recognition"
    >
      <div className="flex shrink-0 items-center gap-2 border-r px-3 sm:px-4">
        <IconHeartHandshake className="size-4 text-[var(--department-primary)]" />
        <span className="text-xs font-semibold uppercase tracking-wide">
          CHERISH
        </span>
      </div>
      <div className="min-w-0 flex-1 overflow-hidden">
        <div
          className={cn(
            "flex w-max items-center",
            items.length > 1 && "cherish-recognition-track",
          )}
        >
          <RecognitionItems items={items} />
          {items.length > 1 ? (
            <RecognitionItems items={items} duplicate />
          ) : null}
        </div>
      </div>
    </section>
  )
}
