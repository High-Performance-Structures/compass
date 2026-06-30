"use client"

import { useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  IconCamera,
  IconCalendarStats,
  IconClipboardText,
  IconDots,
  IconEye,
  IconFileDollar,
  IconFolder,
  IconMessageCircle,
  IconPalette,
  IconUsers,
} from "@tabler/icons-react"

import { openProjectConversationChannel } from "@/app/actions/project-messages"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

export function ProjectActionsMenu({
  projectId,
  projectDriveFolderId,
}: {
  readonly projectId: string
  readonly projectDriveFolderId: string | null
}): React.ReactElement {
  const projectFilesHref = projectDriveFolderId
    ? `/dashboard/files/folder/${projectDriveFolderId}`
    : "/dashboard/files?view=projects"
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function handleOpenMessages(): void {
    setError(null)
    startTransition(async () => {
      const result = await openProjectConversationChannel(projectId)
      if (!result.success) {
        setError(result.error)
        return
      }
      router.push(`/dashboard/conversations/${result.data.channelId}`)
      router.refresh()
    })
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Project actions"
          className="mt-0.5 shrink-0 rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent"
        >
          <IconDots className="size-5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        {error && (
          <div className="px-2 py-1.5 text-xs text-destructive">
            {error}
          </div>
        )}
        <DropdownMenuItem asChild>
          <Link href={projectFilesHref}>
            <IconFolder />
            Project files
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href={`/dashboard/projects/${projectId}/schedule`}>
            <IconCalendarStats />
            Schedule
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href={`/dashboard/projects/${projectId}/photos`}>
            <IconCamera />
            Photo review
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href={`/dashboard/projects/${projectId}/daily-logs`}>
            <IconClipboardText />
            Daily logs
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href={`/dashboard/projects/${projectId}/selections`}>
            <IconPalette />
            Selections
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href={`/dashboard/projects/${projectId}/budget`}>
            <IconFileDollar />
            Budget
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href={`/dashboard/projects/${projectId}/contacts`}>
            <IconUsers />
            Contacts
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={isPending}
          onSelect={(event) => {
            event.preventDefault()
            handleOpenMessages()
          }}
        >
          <IconMessageCircle />
          {isPending ? "Opening..." : "Messages"}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href={`/dashboard/projects/${projectId}/preview/owner`}>
            <IconEye />
            Owner preview
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href={`/dashboard/projects/${projectId}/preview/sub-vendor`}>
            <IconUsers />
            Sub/vendor preview
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
