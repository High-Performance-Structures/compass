"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Archive, MoreHorizontal, RotateCcw, Trash2 } from "lucide-react"
import {
  archiveChannel,
  deleteChannel,
  restoreChannel,
} from "@/app/actions/conversations"
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

type ChannelManagementMenuProps = {
  readonly channelId: string
  readonly channelName: string
  readonly archivedAt: string | null
  readonly canUpdate: boolean
  readonly canDelete: boolean
}

export function ChannelManagementMenu({
  channelId,
  channelName,
  archivedAt,
  canUpdate,
  canDelete,
}: ChannelManagementMenuProps): React.ReactElement | null {
  const router = useRouter()
  const [deleteOpen, setDeleteOpen] = React.useState(false)
  const [isPending, startTransition] = React.useTransition()
  const [error, setError] = React.useState<string | null>(null)

  if (!canUpdate && !canDelete) {
    return null
  }

  function handleArchive(): void {
    setError(null)
    startTransition(async () => {
      const result = await archiveChannel(channelId)
      if (!result.success) {
        setError(result.error ?? "Failed to archive channel")
        return
      }
      router.push("/dashboard/conversations")
      router.refresh()
    })
  }

  function handleRestore(): void {
    setError(null)
    startTransition(async () => {
      const result = await restoreChannel(channelId)
      if (!result.success) {
        setError(result.error ?? "Failed to restore channel")
        return
      }
      router.refresh()
    })
  }

  function handleDelete(): void {
    setError(null)
    startTransition(async () => {
      const result = await deleteChannel(channelId)
      if (!result.success) {
        setError(result.error ?? "Failed to delete channel")
        return
      }
      setDeleteOpen(false)
      router.push("/dashboard/conversations")
      router.refresh()
    })
  }

  return (
    <>
      <div className="flex items-center gap-1">
        {error && (
          <p className="max-w-52 truncate text-xs text-destructive">{error}</p>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              disabled={isPending}
              aria-label="Conversation actions"
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            {canUpdate && archivedAt ? (
              <DropdownMenuItem onClick={handleRestore}>
                <RotateCcw className="size-4" />
                Restore channel
              </DropdownMenuItem>
            ) : null}
            {canUpdate && !archivedAt ? (
              <DropdownMenuItem onClick={handleArchive}>
                <Archive className="size-4" />
                Archive channel
              </DropdownMenuItem>
            ) : null}
            {canDelete ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  onClick={() => setDeleteOpen(true)}
                >
                  <Trash2 className="size-4" />
                  Delete channel
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this channel?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes #{channelName} and its message history.
              Archive the channel instead if the record should remain available.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete channel
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
