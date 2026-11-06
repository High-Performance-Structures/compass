import type * as React from "react"
import Link from "next/link"

import { Button } from "@/components/ui/button"

type StatusFilterOption<V extends string> = {
  readonly value: V
  readonly label: string
  readonly count: number
  /** Shown even with no records (such as Open and All). Others hide at zero. */
  readonly pinned?: boolean
}

type StatusFilterBarProps<V extends string> = {
  /** What is being filtered, for screen readers: "Filter purchase orders by status". */
  readonly label: string
  readonly options: readonly StatusFilterOption<V>[]
  readonly selected: V
} & (
  | {
      /** Filters kept in the URL (`?status=`), so links and refreshes keep the view. */
      readonly kind: "link"
      readonly hrefFor: (value: V) => string
    }
  | {
      /** Filters held in the page's own state. */
      readonly kind: "button"
      readonly onSelect: (value: V) => void
    }
)

/**
 * The status filter buttons above a record list (ui-standards.md, "Record
 * lists"): one button per status the record type really has, each with its
 * count. Statuses with no records hide unless pinned or selected.
 */
export function StatusFilterBar<V extends string>(props: StatusFilterBarProps<V>): React.ReactElement {
  const { label, options, selected } = props
  const visible = options.filter((option) => option.pinned || option.count > 0 || option.value === selected)
  return (
    <nav aria-label={label} className="flex flex-wrap gap-1">
      {visible.map((option) => {
        const active = option.value === selected
        const content = (
          <>
            {option.label}
            <span className="tabular-nums text-muted-foreground">{option.count}</span>
          </>
        )
        return props.kind === "link" ? (
          <Button key={option.value} asChild size="sm" variant={active ? "secondary" : "ghost"}>
            <Link href={props.hrefFor(option.value)} aria-current={active ? "page" : undefined}>
              {content}
            </Link>
          </Button>
        ) : (
          <Button
            key={option.value}
            type="button"
            size="sm"
            variant={active ? "secondary" : "ghost"}
            aria-pressed={active}
            onClick={() => props.onSelect(option.value)}
          >
            {content}
          </Button>
        )
      })}
    </nav>
  )
}
