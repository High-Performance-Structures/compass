"use client"

import * as React from "react"
import { IconChevronDown, IconArrowsSort } from "@tabler/icons-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"

export interface FilterOption {
  label: string
  value: string
}

export interface FilterConfig {
  id: string
  label: string
  value: string
  options: FilterOption[]
}

export interface SortOption {
  label: string
  value: string
}

interface MobileFilterBarProps {
  filters: FilterConfig[]
  sortOptions?: SortOption[]
  currentSort?: string
  onFilterChange?: (filterId: string, value: string) => void
  onSortChange?: (value: string) => void
}

function FilterChip({
  label,
  value,
  isActive,
  onClick,
}: {
  label: string
  value: string
  isActive: boolean
  onClick: () => void
}) {
  return (
    <button
      className={cn(
        "inline-flex h-8 shrink-0 items-center gap-1 rounded-full border px-3 text-sm active:bg-muted",
        isActive
          ? "border-primary bg-primary/10"
          : "bg-background"
      )}
      onClick={onClick}
    >
      <span className="text-muted-foreground">{label}:</span>
      <span className="font-medium">{value}</span>
      <IconChevronDown className="size-3" />
    </button>
  )
}

export function MobileFilterBar({
  filters,
  sortOptions,
  currentSort,
  onFilterChange,
  onSortChange,
}: MobileFilterBarProps) {
  const [activeFilter, setActiveFilter] = React.useState<string | null>(null)
  const [sortOpen, setSortOpen] = React.useState(false)

  const activeFilterConfig = filters.find((f) => f.id === activeFilter)

  return (
    <>
      <div className="flex items-center gap-2 overflow-x-auto border-b p-2 md:hidden [&::-webkit-scrollbar]:hidden">
        {filters.map((filter) => (
          <FilterChip
            key={filter.id}
            label={filter.label}
            value={filter.value}
            isActive={filter.value !== "All" && filter.value !== "Any time"}
            onClick={() => setActiveFilter(filter.id)}
          />
        ))}
        {sortOptions && (
          <Button
            variant="outline"
            size="sm"
            className="shrink-0 h-8 rounded-full"
            onClick={() => setSortOpen(true)}
          >
            <IconArrowsSort className="mr-1 size-3" />
            Sort
          </Button>
        )}
      </div>

      {/* filter options sheet */}
      <Sheet
        open={!!activeFilter}
        onOpenChange={(open) => !open && setActiveFilter(null)}
      >
        <SheetContent side="bottom" className="p-0" showClose={false}>
          <SheetHeader className="border-b px-4 py-3 text-left">
            <SheetTitle className="text-base font-medium">
              {activeFilterConfig?.label || "Filter"}
            </SheetTitle>
          </SheetHeader>
          <div className="py-2">
            {activeFilterConfig?.options.map((option) => (
              <button
                key={option.value}
                className={cn(
                  "flex w-full items-center px-4 py-3 text-left text-sm active:bg-muted/50",
                  option.value === activeFilterConfig.value && "font-medium text-primary"
                )}
                onClick={() => {
                  onFilterChange?.(activeFilterConfig.id, option.value)
                  setActiveFilter(null)
                }}
              >
                {option.label}
              </button>
            ))}
          </div>
        </SheetContent>
      </Sheet>

      {/* sort options sheet */}
      <Sheet open={sortOpen} onOpenChange={setSortOpen}>
        <SheetContent side="bottom" className="p-0" showClose={false}>
          <SheetHeader className="border-b px-4 py-3 text-left">
            <SheetTitle className="text-base font-medium">Sort by</SheetTitle>
          </SheetHeader>
          <div className="py-2">
            {sortOptions?.map((option) => (
              <button
                key={option.value}
                className={cn(
                  "flex w-full items-center px-4 py-3 text-left text-sm active:bg-muted/50",
                  option.value === currentSort && "font-medium text-primary"
                )}
                onClick={() => {
                  onSortChange?.(option.value)
                  setSortOpen(false)
                }}
              >
                {option.label}
              </button>
            ))}
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}
