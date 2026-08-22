"use client"

import Link from "next/link"
import {
  IconCamera,
  IconCalendarStats,
  IconClipboardText,
  IconDots,
  IconEye,
  IconFileDollar,
  IconFolder,
  IconPalette,
  IconUsers,
} from "@tabler/icons-react"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ProjectAudiencePreviewLink } from "@/components/projects/project-audience-preview-link"

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
        <DropdownMenuItem asChild>
          <ProjectAudiencePreviewLink audience="owner" projectId={projectId}>
            <IconEye />
            Owner preview
          </ProjectAudiencePreviewLink>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <ProjectAudiencePreviewLink
            audience="sub-vendor"
            projectId={projectId}
          >
            <IconUsers />
            Sub/vendor preview
          </ProjectAudiencePreviewLink>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
