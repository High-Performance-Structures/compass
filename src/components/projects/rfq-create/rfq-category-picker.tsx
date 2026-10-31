"use client"

import { IconCheck, IconChevronDown } from "@tabler/icons-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { cn } from "@/lib/utils"

import type { RfqCategoryState } from "./use-rfq-create-draft"

/** "Vendor category / trade": a CSI trade, or a typed category. */
export function RfqCategoryPicker({
  category,
}: {
  readonly category: RfqCategoryState
}): React.ReactElement {
  const {
    categoryPickerOpen,
    setCategoryPickerOpen,
    categoryQuery,
    setCategoryQuery,
    vendorCategory,
    vendorCategoryOptions,
    selectVendorCategory,
    useTypedVendorCategory,
    clearVendorCategory,
  } = category
  return (
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground">
                  Vendor category / trade
                </Label>
                <Popover
                  open={categoryPickerOpen}
                  onOpenChange={setCategoryPickerOpen}
                >
                  <PopoverTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      className={cn(
                        "h-10 w-full justify-between rounded-none border-x-0 border-t-0 bg-background px-0 text-left font-normal shadow-none",
                        !vendorCategory && "text-muted-foreground"
                      )}
                    >
                      <span className="min-w-0 truncate">
                        {vendorCategory || "Choose trade/category..."}
                      </span>
                      <IconChevronDown className="size-4 shrink-0 opacity-60" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent
                    align="start"
                    className="w-[min(30rem,calc(100vw-3rem))] p-0"
                  >
                    <div className="border-b p-3">
                      <Input
                        value={categoryQuery}
                        onChange={(event) =>
                          setCategoryQuery(event.target.value)
                        }
                        placeholder="Search trade or type a category..."
                        autoFocus
                      />
                    </div>
                    <div className="compass-content-scroll max-h-72 overflow-y-auto p-2">
                      {vendorCategoryOptions.length > 0 ? (
                        vendorCategoryOptions.map((option) => (
                          <button
                            key={`${option.division ?? "misc"}-${option.label}`}
                            type="button"
                            onClick={() => selectVendorCategory(option)}
                            className="flex w-full items-start justify-between gap-3 rounded-md px-2 py-2 text-left text-sm hover:bg-accent"
                          >
                            <span className="min-w-0">
                              <span className="block truncate font-medium">
                                {option.label}
                              </span>
                              {option.division && (
                                <span className="block truncate text-xs text-muted-foreground">
                                  Division {option.division}
                                </span>
                              )}
                            </span>
                            {vendorCategory === option.label && (
                              <IconCheck className="mt-0.5 size-4 shrink-0" />
                            )}
                          </button>
                        ))
                      ) : (
                        <p className="px-2 py-3 text-sm text-muted-foreground">
                          No matching categories.
                        </p>
                      )}
                    </div>
                    <div className="flex items-center justify-between gap-2 border-t p-2">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={clearVendorCategory}
                      >
                        Clear
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={!categoryQuery.trim()}
                        onClick={useTypedVendorCategory}
                      >
                        Use typed category
                      </Button>
                    </div>
                  </PopoverContent>
                </Popover>
              </div>
  )
}
