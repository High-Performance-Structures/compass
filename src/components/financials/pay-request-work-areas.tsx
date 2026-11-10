"use client"

/*
 * The pay request page's "Work on" picker, after the Estimate page's: one area
 * shows at a time (Billing, Sage, Payments, Shop tickets) and the choice is
 * kept in `?work=` so a link opens the same area. Every area stays mounted, so
 * switching never loses typed values.
 */

import { useState } from "react"

import { SearchableCombobox } from "@/components/searchable-combobox"
import { Label } from "@/components/ui/label"
import {
  DEFAULT_PAY_REQUEST_WORK_AREA,
  PAY_REQUEST_WORK_AREAS,
  isPayRequestWorkArea,
  type PayRequestWorkArea,
} from "@/lib/financials/pay-request-work-areas"

/** What an area shows when it has nothing for this pay request. */
export function PayRequestWorkAreaEmpty({ children }: { readonly children: React.ReactNode }): React.ReactElement {
  return <p className="clarity-panel px-4 py-6 text-center text-sm text-muted-foreground">{children}</p>
}

export function PayRequestWorkAreas({
  initialArea,
  areas,
}: {
  readonly initialArea: PayRequestWorkArea
  readonly areas: Readonly<Record<PayRequestWorkArea, React.ReactNode>>
}): React.ReactElement {
  const [area, setArea] = useState<PayRequestWorkArea>(initialArea)

  function choose(next: PayRequestWorkArea): void {
    setArea(next)
    // Replace the URL in place: a router navigation would reload every Sage
    // read on this server-rendered page just to switch tabs.
    const url = new URL(window.location.href)
    if (next === DEFAULT_PAY_REQUEST_WORK_AREA) url.searchParams.delete("work")
    else url.searchParams.set("work", next)
    window.history.replaceState(null, "", url)
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-3 border-y bg-muted/35 px-4 py-3">
        <Label htmlFor="pay-request-work-area">Work on</Label>
        <SearchableCombobox
          id="pay-request-work-area"
          ariaLabel="Work on"
          placeholder="Choose an area"
          searchPlaceholder="Search pay request areas..."
          className="w-full sm:w-64"
          value={area}
          options={PAY_REQUEST_WORK_AREAS}
          onValueChange={(value) => {
            if (isPayRequestWorkArea(value)) choose(value)
          }}
        />
        <p className="text-xs text-muted-foreground">
          {PAY_REQUEST_WORK_AREAS.find((option) => option.value === area)?.description}
        </p>
      </div>
      {PAY_REQUEST_WORK_AREAS.map((option) => (
        <div key={option.value} className="space-y-3" hidden={area !== option.value}>
          {areas[option.value]}
        </div>
      ))}
    </>
  )
}
