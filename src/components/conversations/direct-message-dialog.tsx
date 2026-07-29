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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"

type DirectMessageRecipient = {
  readonly id: string
  readonly name: string
  readonly email: string
  readonly avatarUrl: string | null
}

export function DirectMessageDialog({
  open,
  onOpenChange,
}: {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
}): React.ReactElement {
  const router = useRouter()
  const [recipients, setRecipients] = React.useState<
    readonly DirectMessageRecipient[]
  >([])
  const [query, setQuery] = React.useState("")
  const [loading, setLoading] = React.useState(false)
  const [startingId, setStartingId] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
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
  }, [open])

  const normalizedQuery = query.trim().toLocaleLowerCase()
  const filteredRecipients = recipients.filter((recipient) =>
    `${recipient.name} ${recipient.email}`
      .toLocaleLowerCase()
      .includes(normalizedQuery)
  )

  async function startMessage(recipientId: string): Promise<void> {
    setStartingId(recipientId)
    const result = await createDirectMessage(recipientId)
    setStartingId(null)
    if (!result.success || !result.data) {
      toast.error(result.error ?? "Could not start the message.")
      return
    }
    onOpenChange(false)
    setQuery("")
    router.push(`/dashboard/conversations/${result.data.channelId}`)
    router.refresh()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New direct message</DialogTitle>
          <DialogDescription>
            Start a private conversation with an internal team member.
          </DialogDescription>
        </DialogHeader>
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
        <ScrollArea className="max-h-80">
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
              filteredRecipients.map((recipient) => (
                <Button
                  key={recipient.id}
                  type="button"
                  variant="ghost"
                  className="h-auto w-full justify-start gap-3 px-3 py-2 text-left"
                  disabled={startingId !== null}
                  onClick={() => void startMessage(recipient.id)}
                >
                  <span className="grid size-9 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
                    {startingId === recipient.id ? (
                      <IconLoader2 className="size-4 animate-spin" />
                    ) : (
                      <IconMessageCircle className="size-4" />
                    )}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">
                      {recipient.name}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {recipient.email}
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
