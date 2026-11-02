"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { IconDots } from "@tabler/icons-react"
import { toast } from "sonner"

import {
  previewImportedConversationShare,
  shareImportedConversation,
} from "@/app/actions/imported-conversations"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { ImportedSharePerson } from "@/lib/domain/conversations/imported-sharing"

type Audience = "clients" | "sub_vendors"

const LABELS: Record<Audience, { readonly menu: string; readonly title: string; readonly who: string }> = {
  clients: { menu: "Share with owner…", title: "Share with the owner?", who: "owner" },
  sub_vendors: { menu: "Share with vendor…", title: "Share with the vendor?", who: "vendor" },
}

/**
 * Staff-only menu on an imported conversation that is still staff-only:
 * opens it to its owner or vendor once staff confirm who it was with. The
 * confirm dialog lists exactly who gets access. Nobody is notified.
 */
export function ImportedThreadShareMenu({ channelId }: { readonly channelId: string }): React.ReactElement {
  const router = useRouter()
  const [audience, setAudience] = React.useState<Audience | null>(null)
  const [people, setPeople] = React.useState<readonly ImportedSharePerson[]>([])
  const [pending, startTransition] = React.useTransition()

  function choose(next: Audience): void {
    startTransition(async () => {
      const result = await previewImportedConversationShare(channelId, next)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      setPeople(result.people)
      setAudience(next)
    })
  }

  function confirm(): void {
    if (!audience) return
    const chosen = audience
    startTransition(async () => {
      const result = await shareImportedConversation(channelId, chosen)
      setAudience(null)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success(`Shared with the ${LABELS[chosen].who}. ${result.people.length} ${result.people.length === 1 ? "person" : "people"} can now see this conversation.`)
      router.refresh()
    })
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Conversation options" disabled={pending}>
            <IconDots className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => choose("clients")}>{LABELS.clients.menu}</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => choose("sub_vendors")}>{LABELS.sub_vendors.menu}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <AlertDialog open={audience !== null} onOpenChange={(open) => { if (!open) setAudience(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{audience ? LABELS[audience].title : ""}</AlertDialogTitle>
            <AlertDialogDescription>
              These people will be able to read and reply to this whole conversation. Nobody is notified.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <ul className="grid gap-1 text-sm">
            {people.map((person) => (
              <li key={person.userId ?? person.projectContactId ?? person.name}>
                {person.name}
                {person.userId ? null : <span className="text-muted-foreground"> (joins when given Compass access)</span>}
              </li>
            ))}
          </ul>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={pending} onClick={confirm}>Share</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
