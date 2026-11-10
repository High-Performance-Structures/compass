"use client"

/*
 * The "Work on" picker for long workspaces: one searchable choice of area,
 * so only that area shows instead of every section stacked down the page.
 * The Estimate page started this pattern; pages pass their own area list
 * (value, label, one-line description) and keep every area mounted with
 * `hidden={area !== "..."}` so typing and open drawers survive a switch.
 * `useWorkOnArea` keeps the area in the URL (`?work=`) so a link opens it.
 */
import * as React from "react"

import { SearchableCombobox } from "@/components/searchable-combobox"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"

export type WorkOnArea<T extends string> = {
  readonly value: T
  readonly label: string
  readonly description: string
}

/**
 * The current area, kept in `?<param>=` without reloading the page. The first
 * area is the default and leaves the parameter off the URL.
 */
export function useWorkOnArea<T extends string>(
  areas: readonly WorkOnArea<T>[],
  initialArea: T,
  param = "work"
): readonly [T, (area: T) => void] {
  const [area, setAreaState] = React.useState<T>(initialArea)
  const setArea = React.useCallback(
    (next: T): void => {
      setAreaState(next)
      const url = new URL(window.location.href)
      if (next === areas[0]?.value) url.searchParams.delete(param)
      else url.searchParams.set(param, next)
      window.history.replaceState(null, "", url)
    },
    [areas, param]
  )
  return [area, setArea] as const
}

export function WorkOnPicker<T extends string>({
  id,
  areas,
  value,
  onValueChange,
  searchPlaceholder = "Search areas...",
  className,
}: {
  readonly id: string
  readonly areas: readonly WorkOnArea<T>[]
  readonly value: T
  readonly onValueChange: (area: T) => void
  readonly searchPlaceholder?: string
  readonly className?: string
}): React.ReactElement {
  return (
    <div className={cn("flex flex-wrap items-center gap-3 border-y bg-estimate-subtotal px-4 py-3", className)}>
      <Label htmlFor={id}>Work on</Label>
      <SearchableCombobox
        id={id}
        ariaLabel="Work on"
        placeholder="Choose an area"
        searchPlaceholder={searchPlaceholder}
        className="w-full sm:w-80"
        value={value}
        options={areas}
        onValueChange={(picked) => {
          // The picker hands back a plain string; only accept a listed area.
          const area = areas.find((item) => item.value === picked)
          if (area) onValueChange(area.value)
        }}
      />
      <p className="text-xs text-muted-foreground">
        {areas.find((area) => area.value === value)?.description}
      </p>
    </div>
  )
}
