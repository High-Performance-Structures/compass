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

import { contactTypeLabel } from "./rfq-draft"
import type { RfqRecipientState } from "./use-rfq-create-draft"

/** "Requested from": project and directory contacts, or a typed name. */
export function RfqRecipientPicker({
  recipient,
}: {
  readonly recipient: RfqRecipientState
}): React.ReactElement {
  const {
    recipientPickerOpen,
    setRecipientPickerOpen,
    recipientQuery,
    setRecipientQuery,
    selectedRecipientId,
    requestedFrom,
    normalizedRecipientQuery,
    projectRecipientOptions,
    directoryRecipientOptions,
    selectRecipient,
    useTypedRecipient,
    clearRecipient,
  } = recipient
  return (
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground">
                  Requested from
                </Label>
                <Popover
                  open={recipientPickerOpen}
                  onOpenChange={setRecipientPickerOpen}
                >
                  <PopoverTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      className={cn(
                        "h-10 w-full justify-between rounded-none border-x-0 border-t-0 bg-background px-0 text-left font-normal shadow-none",
                        !requestedFrom && "text-muted-foreground"
                      )}
                    >
                      <span className="min-w-0 truncate">
                        {requestedFrom ||
                          "Choose vendor, sub, or type a name..."}
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
                        value={recipientQuery}
                        onChange={(event) =>
                          setRecipientQuery(event.target.value)
                        }
                        placeholder="Search contacts or type a name..."
                        autoFocus
                      />
                    </div>
                    <div className="max-h-72 overflow-y-auto p-2">
                      {projectRecipientOptions.length > 0 && (
                        <div className="space-y-1">
                          <p className="px-2 py-1 text-xs font-medium text-muted-foreground">
                            Project &amp; team contacts
                          </p>
                          {projectRecipientOptions.map((option) => (
                            <button
                              key={option.id}
                              type="button"
                              onClick={() => selectRecipient(option)}
                              className="flex w-full items-start justify-between gap-3 rounded-md px-2 py-2 text-left text-sm hover:bg-accent"
                            >
                              <span className="min-w-0">
                                <span className="block truncate font-medium">
                                  {option.companyName ?? option.name}
                                </span>
                                <span className="block truncate text-xs text-muted-foreground">
                                  {option.email ??
                                    contactTypeLabel(option.contactType)}
                                </span>
                              </span>
                              {selectedRecipientId === option.id && (
                                <IconCheck className="mt-0.5 size-4 shrink-0" />
                              )}
                            </button>
                          ))}
                        </div>
                      )}

                      {directoryRecipientOptions.length > 0 && (
                        <div className="mt-2 space-y-1 border-t pt-2">
                          <p className="px-2 py-1 text-xs font-medium text-muted-foreground">
                            Directory contacts
                          </p>
                          {directoryRecipientOptions.map((option) => (
                            <button
                              key={option.id}
                              type="button"
                              onClick={() => selectRecipient(option)}
                              className="flex w-full items-start justify-between gap-3 rounded-md px-2 py-2 text-left text-sm hover:bg-accent"
                            >
                              <span className="min-w-0">
                                <span className="block truncate font-medium">
                                  {option.name}
                                </span>
                                <span className="block truncate text-xs text-muted-foreground">
                                  Not on this project yet
                                </span>
                              </span>
                              {selectedRecipientId === option.id && (
                                <IconCheck className="mt-0.5 size-4 shrink-0" />
                              )}
                            </button>
                          ))}
                        </div>
                      )}

                      {normalizedRecipientQuery &&
                        projectRecipientOptions.length === 0 &&
                        directoryRecipientOptions.length === 0 && (
                          <p className="px-2 py-3 text-sm text-muted-foreground">
                            No matching contacts.
                          </p>
                        )}
                    </div>
                    <div className="flex items-center justify-between gap-2 border-t p-2">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={clearRecipient}
                      >
                        Clear
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={!recipientQuery.trim()}
                        onClick={useTypedRecipient}
                      >
                        Use typed name
                      </Button>
                    </div>
                  </PopoverContent>
                </Popover>
              </div>
  )
}
