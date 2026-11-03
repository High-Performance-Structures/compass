"use client"

import * as React from "react"
import { IconUsers } from "@tabler/icons-react"

import type { ProjectPhotoLibrary } from "@/app/actions/project-photos"
import { ContextualHelpBeacon } from "@/components/help/contextual-help-beacon"
import { Button } from "@/components/ui/button"
import { SearchableCombobox } from "@/components/searchable-combobox"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  NO_PHASE_VALUE,
  photoSortValue,
  visibilityFilterValue,
  type PhotoSort,
  type VisibilityFilter,
} from "@/lib/photos/review"

export type PhotoReviewFilters = {
  readonly dateFilter: string
  readonly setDateFilter: (value: string) => void
  readonly phaseFilter: string
  readonly setPhaseFilter: (value: string) => void
  readonly photoSort: PhotoSort
  readonly setPhotoSort: (value: PhotoSort) => void
  readonly visibilityFilter: VisibilityFilter
  readonly setVisibilityFilter: (value: VisibilityFilter) => void
}

export type PhotoReviewBatch = {
  readonly photoKind: string
  readonly setPhotoKind: (value: string) => void
  readonly ownerVisible: boolean
  readonly setOwnerVisible: (value: boolean) => void
  readonly subVendorVisible: boolean
  readonly setSubVendorVisible: (value: boolean) => void
  readonly publicShareable: boolean
  readonly setPublicShareable: (value: boolean) => void
}

/** Date, visibility, phase and sort filters, selection, and the batch visibility actions. */
export function PhotoReviewToolbar({
  phases,
  filters,
  batch,
  filteredCount,
  selectedCount,
  isPending,
  message,
  onSelectFiltered,
  onClearSelection,
  onApplyPermissions,
  onRejectSelected,
}: {
  readonly phases: ProjectPhotoLibrary["phases"]
  readonly filters: PhotoReviewFilters
  readonly batch: PhotoReviewBatch
  readonly filteredCount: number
  readonly selectedCount: number
  readonly isPending: boolean
  readonly message: string | null
  readonly onSelectFiltered: () => void
  readonly onClearSelection: () => void
  readonly onApplyPermissions: () => void
  readonly onRejectSelected: () => void
}): React.ReactElement {
  const { dateFilter, setDateFilter, phaseFilter, setPhaseFilter } = filters
  return (
    <section className="border-y py-3">
      <div className="space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <label className="w-full space-y-1 text-sm sm:w-56">
            <span className="text-xs font-medium uppercase text-muted-foreground">
              Date
            </span>
            <input
              type="date"
              value={dateFilter}
              onChange={(event) => setDateFilter(event.target.value)}
              className="h-9 w-full rounded-md border bg-background px-3 text-sm"
            />
          </label>
          <label className="w-full space-y-1 text-sm sm:w-56">
            <span className="text-xs font-medium uppercase text-muted-foreground">
              Visibility
            </span>
            <SearchableCombobox
              value={filters.visibilityFilter}
              onValueChange={(value) =>
                filters.setVisibilityFilter(visibilityFilterValue(value || "all"))
              }
              options={[
                { value: "all", label: "All photos" },
                { value: "internal", label: "Internal only" },
                { value: "owner", label: "Owner visible" },
                { value: "subs_vendors", label: "Subs/vendors" },
                { value: "public", label: "Public/shareable" },
                { value: "needs_review", label: "Needs review" },
                { value: "approved", label: "Approved" },
              ]}
              ariaLabel="Visibility"
              placeholder="All photos"
              searchPlaceholder="Search visibility..."
              emptyMessage="No matching options."
            />
          </label>
          <label className="w-full space-y-1 text-sm sm:w-60">
            <span className="text-xs font-medium uppercase text-muted-foreground">
              Phase
            </span>
            <SearchableCombobox
              ariaLabel="Phase"
              options={[
                { value: "all", label: "All phases" },
                { value: NO_PHASE_VALUE, label: "No phase" },
                ...phases.map((phase) => ({
                  value: phase.value,
                  label: `${phase.label} (${phase.count})`,
                })),
              ]}
              value={phaseFilter}
              onValueChange={setPhaseFilter}
              placeholder="All phases"
              searchPlaceholder="Search phases..."
              emptyMessage="No matching phases."
              groupHeading="Phases"
              className="h-9"
            />
          </label>
          <label className="w-full space-y-1 text-sm sm:w-56">
            <span className="text-xs font-medium uppercase text-muted-foreground">
              Sort
            </span>
            <Select
              value={filters.photoSort}
              onValueChange={(value) => filters.setPhotoSort(photoSortValue(value))}
            >
              <SelectTrigger aria-label="Sort photos" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="newest">Date, newest first</SelectItem>
                <SelectItem value="oldest">Date, oldest first</SelectItem>
                <SelectItem value="phase_newest">
                  Phase, newest first
                </SelectItem>
                <SelectItem value="phase_oldest">
                  Phase, oldest first
                </SelectItem>
              </SelectContent>
            </Select>
          </label>
          <div className="flex flex-wrap gap-2">
            {dateFilter.length > 0 && (
              <Button
                type="button"
                variant="ghost"
                onClick={() => setDateFilter("")}
              >
                All dates
              </Button>
            )}
            {phaseFilter !== "all" && (
              <Button
                type="button"
                variant="ghost"
                onClick={() => setPhaseFilter("all")}
              >
                All phases
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              onClick={onSelectFiltered}
              disabled={filteredCount === 0}
            >
              Select filtered
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={onClearSelection}
              disabled={selectedCount === 0}
            >
              Clear
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t pt-3">
          <div className="mr-2 min-w-40">
            <div className="flex items-center gap-1.5">
              <p className="text-sm font-medium">
                {selectedCount} selected
              </p>
              <ContextualHelpBeacon topicId="photos.visibility.batch-actions" />
            </div>
            <p className="text-xs text-muted-foreground">
              Apply updates visibility.
            </p>
          </div>
          <Select
            value={batch.photoKind}
            onValueChange={batch.setPhotoKind}
          >
            <SelectTrigger aria-label="Photo type" className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="progress">Progress</SelectItem>
              <SelectItem value="issue">Issue</SelectItem>
              <SelectItem value="delivery">Delivery</SelectItem>
              <SelectItem value="selection">Selection</SelectItem>
              <SelectItem value="archive">Archive</SelectItem>
            </SelectContent>
          </Select>
          <label className="inline-flex h-9 items-center gap-1.5 text-sm">
            <input
              type="checkbox"
              checked={batch.ownerVisible}
              onChange={(event) => batch.setOwnerVisible(event.target.checked)}
            />
            Owner
          </label>
          <label className="inline-flex h-9 items-center gap-1.5 text-sm">
            <input
              type="checkbox"
              checked={batch.subVendorVisible}
              onChange={(event) =>
                batch.setSubVendorVisible(event.target.checked)
              }
            />
            Subs/vendors
          </label>
          <label className="inline-flex h-9 items-center gap-1.5 text-sm">
            <input
              type="checkbox"
              checked={batch.publicShareable}
              onChange={(event) =>
                batch.setPublicShareable(event.target.checked)
              }
            />
            Public
          </label>
          <Button
            type="button"
            onClick={onApplyPermissions}
            disabled={selectedCount === 0 || isPending}
          >
            <IconUsers className="size-4" />
            Apply visibility
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={onRejectSelected}
            disabled={selectedCount === 0 || isPending}
          >
            Reject selected
          </Button>
          {message && (
            <p className="basis-full text-xs text-muted-foreground">
              {message}
            </p>
          )}
        </div>
      </div>
    </section>
  )
}
