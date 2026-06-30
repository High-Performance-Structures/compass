"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import {
  IconFolder,
  IconHash,
  IconPin,
  IconSearch,
  IconUsers,
} from "@tabler/icons-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { PinnedMessagesPanel } from "@/components/conversations/pinned-messages-panel"
import { SearchDialog } from "@/components/conversations/search-dialog"
import { ChannelManagementMenu } from "@/components/conversations/channel-management-menu"

type ChannelHeaderProps = {
  readonly channelId: string
  readonly name: string
  readonly description?: string
  readonly project?: {
    readonly id: string
    readonly name: string
    readonly projectNumber: string | null
    readonly clientName: string | null
  } | null
  readonly memberCount: number
  readonly audience: string
  readonly archivedAt: string | null
  readonly canUpdate: boolean
  readonly canDelete: boolean
}

function projectLabel(project: NonNullable<ChannelHeaderProps["project"]>): string {
  return project.projectNumber
    ? `${project.projectNumber} - ${project.name}`
    : project.name
}

function audienceLabel(audience: string): string {
  if (audience === "staff") return "Staff"
  if (audience === "clients") return "Clients"
  if (audience === "sub_vendors") return "Subs/Suppliers"
  return "Everyone"
}

export function ChannelHeader({
  channelId,
  name,
  description,
  project = null,
  memberCount,
  audience,
  archivedAt,
  canUpdate,
  canDelete,
}: ChannelHeaderProps) {
  const router = useRouter()
  const [searchOpen, setSearchOpen] = React.useState(false)
  const [pinnedOpen, setPinnedOpen] = React.useState(false)

  function jumpToMessage(_messageId: string, targetChannelId: string): void {
    router.push(`/dashboard/conversations/${targetChannelId}`)
  }

  return (
    <>
      <header className="flex h-14 shrink-0 items-center justify-between border-b px-4">
        <div className="flex items-center gap-2 overflow-hidden">
          <IconHash className="h-5 w-5 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-base font-semibold">{name}</h1>
            <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
              {archivedAt ? (
                <Badge variant="outline" className="h-5 shrink-0 px-1.5 text-[10px]">
                  Archived
                </Badge>
              ) : null}
              <Badge variant="secondary" className="h-5 shrink-0 px-1.5 text-[10px]">
                {audienceLabel(audience)}
              </Badge>
              {project ? (
                <>
                  <IconFolder className="size-3.5 shrink-0" />
                  <Link
                    href={`/dashboard/projects/${project.id}`}
                    className="truncate font-medium text-foreground/80 hover:text-foreground hover:underline"
                  >
                    {projectLabel(project)}
                  </Link>
                  {description && (
                    <>
                      <span className="shrink-0">·</span>
                      <span className="truncate">{description}</span>
                    </>
                  )}
                </>
              ) : (
                description && <span className="truncate">{description}</span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <div className="mr-2 flex items-center gap-1 text-xs text-muted-foreground">
            <IconUsers className="h-4 w-4" />
            <span>{memberCount}</span>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            aria-label="Search messages"
            onClick={() => setSearchOpen(true)}
          >
            <IconSearch className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            aria-label="Pinned messages"
            onClick={() => setPinnedOpen(true)}
          >
            <IconPin className="h-4 w-4" />
          </Button>
          <ChannelManagementMenu
            channelId={channelId}
            channelName={name}
            archivedAt={archivedAt}
            canUpdate={canUpdate}
            canDelete={canDelete}
          />
        </div>
      </header>
      <SearchDialog
        open={searchOpen}
        onOpenChange={setSearchOpen}
        onJumpToMessage={jumpToMessage}
      />
      <PinnedMessagesPanel
        channelId={channelId}
        isOpen={pinnedOpen}
        onClose={() => setPinnedOpen(false)}
        onJumpToMessage={(messageId) => jumpToMessage(messageId, channelId)}
      />
    </>
  )
}
