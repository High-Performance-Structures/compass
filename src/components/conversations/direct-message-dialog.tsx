"use client"

import * as React from "react"
import { IconLoader2, IconMessageCircle, IconSearch } from "@tabler/icons-react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import {
  createDirectMessage,
  listDirectMessageRecipients,
} from "@/app/actions/conversations"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"

type DirectMessageRecipient = {
  readonly id: string
  readonly name: string
  readonly email: string
  readonly avatarUrl: string | null
}

export function DirectMessagePicker({
  onStarted,
}: {
  readonly onStarted: (channelId: string) => void
}): React.ReactElement {
  const [recipients, setRecipients] = React.useState<readonly DirectMessageRecipient[]>([])
  const [query, setQuery] = React.useState("")
  const [loading, setLoading] = React.useState(true)
  const [selectedIds, setSelectedIds] = React.useState<readonly string[]>([])
  const [starting, setStarting] = React.useState(false)

  React.useEffect(() => {
    let cancelled = false
    void listDirectMessageRecipients().then((result) => {
      if (cancelled) return
      if (result.success && result.data) {
        setRecipients(result.data)
      } else {
        toast.error(result.error ?? "Could not load team members.")
      }
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const normalizedQuery = query.trim().toLocaleLowerCase()
  const filteredRecipients = recipients.filter((recipient) =>
    `${recipient.name} ${recipient.email}`
      .toLocaleLowerCase()
      .includes(normalizedQuery)
  )

  function toggleRecipient(recipientId: string, selected: boolean): void {
    setSelectedIds((current) =>
      selected
        ? Array.from(new Set([...current, recipientId]))
        : current.filter((id) => id !== recipientId)
    )
  }

  async function startMessage(): Promise<void> {
    if (selectedIds.length === 0) return
    setStarting(true)
    try {
      const result = await createDirectMessage(selectedIds)
      if (!result.success || !result.data) {
        toast.error(result.error ?? "Could not start the conversation.")
        return
      }
      onStarted(result.data.channelId)
    } catch {
      toast.error("Could not start the conversation.")
    } finally {
      setStarting(false)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-3">
      <p className="text-xs text-muted-foreground">
        Select one or more internal team members for a private conversation.
      </p>
      <div className="relative">
        <IconSearch className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
          placeholder="Find a team member"
          className="pl-9"
          autoFocus
        />
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-1 pr-3">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
              <IconLoader2 className="size-4 animate-spin" />
              Loading team members…
            </div>
          ) : filteredRecipients.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              No matching team members.
            </p>
          ) : (
            filteredRecipients.map((recipient) => {
              const selected = selectedIds.includes(recipient.id)
              return (
                <div
                  key={recipient.id}
                  className={cn(
                    "flex cursor-pointer items-center gap-3 px-3 py-2 text-left hover:bg-accent has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50",
                    selected && "bg-accent"
                  )}
                  onClick={() => {
                    if (!starting) toggleRecipient(recipient.id, !selected)
                  }}
                >
                  <span className="grid size-9 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
                    <IconMessageCircle className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{recipient.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">{recipient.email}</span>
                  </span>
                  <Checkbox
                    checked={selected}
                    disabled={starting}
                    onClick={(event) => event.stopPropagation()}
                    onCheckedChange={(checked) => toggleRecipient(recipient.id, checked === true)}
                    aria-label={`Include ${recipient.name}`}
                  />
                </div>
              )
            })
          )}
        </div>
      </ScrollArea>
      <div className="flex flex-col gap-2 border-t pt-3 sm:flex-row sm:items-center sm:justify-between">
        <span className="text-sm text-muted-foreground">
          {selectedIds.length === 0
            ? "Choose at least one person"
            : `${selectedIds.length} team member${selectedIds.length === 1 ? "" : "s"} selected`}
        </span>
        <Button type="button" disabled={selectedIds.length === 0 || starting} onClick={() => void startMessage()}>
          {starting ? <IconLoader2 className="size-4 animate-spin" /> : null}
          Start conversation
        </Button>
      </div>
    </div>
  )
}

export function DirectMessageDialog({
  open,
  onOpenChange,
}: {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
}): React.ReactElement {
  const router = useRouter()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[80vh] flex-col sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New direct message</DialogTitle>
          <DialogDescription>
            Select one or more internal team members for a private conversation.
          </DialogDescription>
        </DialogHeader>
        <DirectMessagePicker
          onStarted={(channelId) => {
            onOpenChange(false)
            router.push(`/dashboard/conversations/${channelId}`)
            router.refresh()
          }}
        />
      </DialogContent>
    </Dialog>
  )
}
