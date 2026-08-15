"use client"

import { useEffect, useState, useTransition } from "react"
import { IconUsers } from "@tabler/icons-react"

import {
  getExternalProjectResourceGrantRecipientIds,
  getExternalProjectResourceRecipients,
  setExternalProjectResourceRecipients,
  type ExternalProjectResourceRecipient,
} from "@/app/actions/project-external-resource-grants"
import type { ExternalProjectResourceType } from "@/lib/project-external-resource-access"
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

export function ProjectExternalResourceSharingDialog({
  projectId,
  resourceId,
  resourceType,
}: {
  readonly projectId: string
  readonly resourceId: string
  readonly resourceType: ExternalProjectResourceType
}) {
  const [open, setOpen] = useState(false)
  const [recipients, setRecipients] = useState<readonly ExternalProjectResourceRecipient[]>([])
  const [selectedIds, setSelectedIds] = useState<readonly string[]>([])
  const [message, setMessage] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    if (!open) return
    startTransition(async () => {
      try {
        const [nextRecipients, nextIds] = await Promise.all([
          getExternalProjectResourceRecipients(projectId),
          getExternalProjectResourceGrantRecipientIds({ projectId, resourceId, resourceType }),
        ])
        setRecipients(nextRecipients)
        setSelectedIds(nextIds)
        setMessage(null)
      } catch {
        setMessage("Unable to load project recipients.")
      }
    })
  }, [open, projectId, resourceId, resourceType])

  function toggleRecipient(userId: string): void {
    setSelectedIds((current) =>
      current.includes(userId)
        ? current.filter((id) => id !== userId)
        : [...current, userId]
    )
  }

  function save(): void {
    startTransition(async () => {
      const result = await setExternalProjectResourceRecipients({
        projectId,
        recipientUserIds: selectedIds,
        resourceId,
        resourceType,
      })
      if (result.success) {
        setOpen(false)
      } else {
        setMessage(result.error)
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs">
          <IconUsers className="size-3.5" /> Share
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Share with project members</DialogTitle>
          <DialogDescription>
            Only selected assigned Owners, Subs, and Suppliers can view this item. Removing a name revokes access immediately.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-72 space-y-2 overflow-y-auto py-1">
          {recipients.map((recipient) => (
            <label key={recipient.userId} className="flex cursor-pointer items-center gap-3 rounded-md border p-3 text-sm">
              <input
                type="checkbox"
                checked={selectedIds.includes(recipient.userId)}
                disabled={isPending}
                onChange={() => toggleRecipient(recipient.userId)}
              />
              <span className="min-w-0">
                <span className="block font-medium">{recipient.displayName}</span>
                <span className="block truncate text-xs text-muted-foreground">{recipient.role} · {recipient.email}</span>
              </span>
            </label>
          ))}
          {!isPending && recipients.length === 0 && (
            <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">No assigned external project members are available.</p>
          )}
        </div>
        {message && <p className="text-sm text-destructive">{message}</p>}
        <DialogFooter>
          <Button type="button" onClick={save} disabled={isPending}>Save access</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
