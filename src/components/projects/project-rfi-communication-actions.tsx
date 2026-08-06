"use client"

import * as React from "react"
import { IconMail, IconLoader2 } from "@tabler/icons-react"
import { toast } from "sonner"

import { createProjectRfiEmailDraft } from "@/app/actions/project-rfis"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"

export type ProjectRfiEmailRecipientOption = {
  readonly email: string
  readonly label: string
  readonly recommended: boolean
}

export function ProjectRfiCommunicationActions({
  projectId,
  rfiId,
  rfiNumber,
  recipientOptions,
}: {
  readonly projectId: string
  readonly rfiId: string
  readonly rfiNumber: string
  readonly recipientOptions: readonly ProjectRfiEmailRecipientOption[]
}): React.ReactElement {
  const [open, setOpen] = React.useState(false)
  const [selected, setSelected] = React.useState<readonly string[]>([])
  const [manualEmail, setManualEmail] = React.useState("")
  const [starting, setStarting] = React.useState(false)

  function openEmailDialog(): void {
    setSelected(
      recipientOptions
        .filter((option) => option.recommended)
        .map((option) => option.email)
    )
    setManualEmail("")
    setOpen(true)
  }

  function toggleEmail(email: string, checked: boolean): void {
    setSelected((current) =>
      checked
        ? Array.from(new Set([...current, email]))
        : current.filter((candidate) => candidate !== email)
    )
  }

  async function openDefaultEmailApp(): Promise<void> {
    const manual = manualEmail.trim()
    const recipients = manual
      ? Array.from(new Set([...selected, manual]))
      : selected
    if (recipients.length === 0) {
      toast.error("Choose or enter at least one recipient.")
      return
    }

    setStarting(true)
    const result = await createProjectRfiEmailDraft(projectId, rfiId, recipients)
    setStarting(false)
    if (!result.success) {
      toast.error(result.error)
      return
    }

    setOpen(false)
    toast.info("Keep Compass in CC or use Reply All so responses stay with this RFI.")
    window.location.href = result.href
  }

  return (
    <>
      <Button type="button" size="sm" variant="outline" onClick={openEmailDialog}>
        <IconMail className="size-4" />
        Email
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Email {rfiNumber}</DialogTitle>
            <DialogDescription>
              Opens your default email app. Compass is automatically copied so
              replies can return to this RFI. Use the response area on the RFI
              for Compass messages and @mentions.
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-64 space-y-1 overflow-y-auto border-y py-2">
            {recipientOptions.length === 0 ? (
              <p className="px-2 py-4 text-sm text-muted-foreground">
                No project contacts have an email address yet.
              </p>
            ) : (
              recipientOptions.map((option) => {
                const checked = selected.includes(option.email)
                return (
                  <label
                    key={option.email}
                    className="flex cursor-pointer items-center gap-3 px-2 py-2 hover:bg-muted"
                  >
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(value) =>
                        toggleEmail(option.email, value === true)
                      }
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {option.label}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {option.email}
                      </span>
                    </span>
                    {option.recommended ? (
                      <span className="text-xs text-muted-foreground">RFI contact</span>
                    ) : null}
                  </label>
                )
              })
            )}
          </div>

          <div className="space-y-1.5">
            <label htmlFor={`rfi-manual-email-${rfiId}`} className="text-sm font-medium">
              Or enter another email
            </label>
            <Input
              id={`rfi-manual-email-${rfiId}`}
              type="email"
              value={manualEmail}
              onChange={(event) => setManualEmail(event.currentTarget.value)}
              placeholder="name@example.com"
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="button" disabled={starting} onClick={() => void openDefaultEmailApp()}>
              {starting ? <IconLoader2 className="size-4 animate-spin" /> : <IconMail className="size-4" />}
              Open email app
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
