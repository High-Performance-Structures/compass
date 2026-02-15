"use client"

import { IconHash, IconSearch, IconPin, IconUsers } from "@tabler/icons-react"
import { Button } from "@/components/ui/button"

type ChannelHeaderProps = {
  readonly name: string
  readonly description?: string
  readonly memberCount: number
}

export function ChannelHeader({
  name,
  description,
  memberCount,
}: ChannelHeaderProps) {
  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b px-4">
      <div className="flex items-center gap-2 overflow-hidden">
        <IconHash className="h-5 w-5 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-base font-semibold">{name}</h1>
          {description && (
            <p className="truncate text-xs text-muted-foreground">
              {description}
            </p>
          )}
        </div>
      </div>
      <div className="flex items-center gap-1">
        <div className="mr-2 flex items-center gap-1 text-xs text-muted-foreground">
          <IconUsers className="h-4 w-4" />
          <span>{memberCount}</span>
        </div>
        <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Search messages">
          <IconSearch className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Pinned messages">
          <IconPin className="h-4 w-4" />
        </Button>
      </div>
    </header>
  )
}
