"use client"

import * as React from "react"
import { IconCopy } from "@tabler/icons-react"
import { useRouter } from "next/navigation"

import type { ProjectTaskAssigneeOption } from "@/app/actions/project-contacts"
import { duplicateRfqRequest } from "@/app/actions/project-operations"
import { SearchableCombobox } from "@/components/searchable-combobox"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"

export function ProjectRfqDuplicateDialog({
  projectId,
  rfqId,
  rfqNumber,
  recipientOptions,
}: {
  readonly projectId: string
  readonly rfqId: string
  readonly rfqNumber: string | null
  readonly recipientOptions: readonly ProjectTaskAssigneeOption[]
}): React.ReactElement {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [pending, startTransition] = React.useTransition()
  const [requestedFrom, setRequestedFrom] = React.useState("")
  const [recipientEmail, setRecipientEmail] = React.useState("")
  const [selectedId, setSelectedId] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)
  const externalOptions = recipientOptions.filter((option) =>
    ["subcontractor", "supplier", "vendor"].includes(option.contactType)
  )
  const selectedRecipient = externalOptions.find(
    (option) => option.id === selectedId
  )

  function selectRecipient(value: string): void {
    setSelectedId(value)
    const option = externalOptions.find((item) => item.id === value)
    if (!option) return
    setRequestedFrom(option.companyName ?? option.name)
    setRecipientEmail(option.email ?? "")
  }

  function submit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    setError(null)
    startTransition(async () => {
      const result = await duplicateRfqRequest(projectId, rfqId, {
        requestedFrom,
        recipientEmail,
      })
      if (!result.success) {
        setError(result.error)
        return
      }
      setOpen(false)
      setRequestedFrom("")
      setRecipientEmail("")
      setSelectedId("")
      router.push(
        `/dashboard/projects/${projectId}/rfqs?created=${encodeURIComponent(result.id)}`
      )
      router.refresh()
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          <IconCopy className="size-4" />
          Duplicate
        </Button>
      </DialogTrigger>
      <DialogContent className="min-w-0 grid-cols-[minmax(0,1fr)] overflow-x-hidden sm:max-w-lg">
        <form onSubmit={submit} className="min-w-0">
          <DialogHeader className="min-w-0">
            <DialogTitle className="break-words">
              Duplicate {rfqNumber ?? "RFQ"}
            </DialogTitle>
            <DialogDescription className="break-words">
              Copy the full scope and document package into a private draft for
              another bidder. Their response will remain separate.
            </DialogDescription>
          </DialogHeader>
          <div className="mt-5 grid min-w-0 gap-4">
            {externalOptions.length > 0 && (
              <div className="grid min-w-0 gap-1.5 text-sm font-medium">
                <span>Project vendor or subcontractor</span>
                <SearchableCombobox
                  ariaLabel="Project vendor or subcontractor"
                  placeholder="Choose a recipient"
                  searchPlaceholder="Search vendors or subcontractors..."
                  value={selectedId}
                  onValueChange={selectRecipient}
                  options={externalOptions.map((option) => ({
                    value: option.id,
                    label: option.companyName
                      ? `${option.companyName} · ${option.name}`
                      : option.name,
                    selectedLabel: option.companyName ?? option.name,
                    description: option.email ?? undefined,
                    keywords: option.name,
                  }))}
                />
              </div>
            )}
            <label className="grid min-w-0 gap-1.5 text-sm font-medium">
              Company or bidder name
              <Input
                className="min-w-0"
                value={requestedFrom}
                onChange={(event) => setRequestedFrom(event.currentTarget.value)}
                maxLength={240}
                required
              />
            </label>
            <label className="grid min-w-0 gap-1.5 text-sm font-medium">
              Recipient email
              <Input
                className="min-w-0"
                type="email"
                value={recipientEmail}
                onChange={(event) => setRecipientEmail(event.currentTarget.value)}
                maxLength={320}
                required
              />
            </label>
            {selectedRecipient && (
              <div className="min-w-0 border-l-2 border-brand-hps-primary px-3 py-2 text-sm break-words">
                <p className="font-medium">
                  {selectedRecipient.projectAccess
                    ? "Compass project access is active."
                    : "Compass project access still needs to be invited."}
                </p>
                {!selectedRecipient.projectAccess && (
                  <p className="mt-1 text-muted-foreground">
                    Create this bidder copy, then invite the contact from the
                    project Team page before sharing the RFQ portal link.
                  </p>
                )}
              </div>
            )}
            {error && (
              <p role="alert" className="min-w-0 text-sm text-destructive break-words">
                {error}
              </p>
            )}
          </div>
          <DialogFooter className="mt-5 min-w-0">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Duplicating..." : "Create bidder copy"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
