"use client"

import * as React from "react"
import { IconMessageCircle, IconSearch } from "@tabler/icons-react"
import { useRouter } from "next/navigation"

import type {
  ProjectAudienceMessageRecipient,
  ProjectAudienceMessageShortcut,
} from "@/lib/project-audience-direct-message"
import { projectAudienceMessageRecipientHref } from "@/lib/project-audience-direct-message"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"

function recipientDetail(
  recipient: ProjectAudienceMessageRecipient
): string {
  return recipient.role ?? "Project team"
}

export function ProjectAudienceDirectMessageDialog({
  open,
  onOpenChange,
  shortcut,
}: {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly shortcut: ProjectAudienceMessageShortcut
}): React.ReactElement {
  const router = useRouter()
  const [query, setQuery] = React.useState("")
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const filteredRecipients = shortcut.recipients.filter((recipient) =>
    `${recipient.displayName} ${recipient.role ?? ""}`
      .toLocaleLowerCase()
      .includes(normalizedQuery)
  )

  function startMessage(recipient: ProjectAudienceMessageRecipient): void {
    onOpenChange(false)
    setQuery("")
    router.push(
      projectAudienceMessageRecipientHref(
        shortcut.conversationHref,
        recipient
      )
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Message your project team</DialogTitle>
          <DialogDescription>
            Choose an internal team member. Your message stays in this
            project&apos;s private conversation.
          </DialogDescription>
        </DialogHeader>
        <div className="relative">
          <IconSearch className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder="Find a project team member"
            className="pl-9"
            autoFocus
          />
        </div>
        <ScrollArea className="max-h-80">
          <div className="space-y-1 pr-3">
            {filteredRecipients.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                No matching project team members.
              </p>
            ) : (
              filteredRecipients.map((recipient) => (
                <Button
                  key={recipient.userId}
                  type="button"
                  variant="ghost"
                  className="h-auto w-full justify-start gap-3 px-3 py-2 text-left"
                  onClick={() => startMessage(recipient)}
                >
                  <span className="grid size-9 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
                    <IconMessageCircle className="size-4" />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">
                      {recipient.displayName}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {recipientDetail(recipient)}
                    </span>
                  </span>
                </Button>
              ))
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  )
}
