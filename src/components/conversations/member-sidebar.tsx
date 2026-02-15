"use client"

import * as React from "react"
import { IconX, IconCrown, IconShield } from "@tabler/icons-react"
import { getChannelMembersWithPresence } from "@/app/actions/presence"
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { cn } from "@/lib/utils"

type MemberWithPresence = {
  readonly id: string
  readonly displayName: string | null
  readonly avatarUrl: string | null
  readonly role: string
  readonly status: string
  readonly statusMessage: string | null
}

type MemberSidebarProps = {
  channelId: string
  isOpen: boolean
  onClose: () => void
}

type MemberGroupProps = {
  readonly title: string
  readonly members: readonly MemberWithPresence[]
  readonly statusColor: string
}

function getStatusColor(status: string): string {
  switch (status) {
    case "online":
      return "bg-green-500"
    case "idle":
      return "bg-yellow-500"
    case "dnd":
      return "bg-red-500"
    default:
      return "bg-gray-400"
  }
}

function getInitials(name: string | null): string {
  if (!name) return "?"
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) {
    return parts[0].charAt(0).toUpperCase()
  }
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase()
}

function getRoleBadgeVariant(
  role: string
): "default" | "secondary" | "outline" {
  switch (role) {
    case "owner":
      return "default"
    case "moderator":
      return "secondary"
    default:
      return "outline"
  }
}

function RoleIcon({ role }: { readonly role: string }) {
  if (role === "owner") {
    return <IconCrown className="h-3 w-3 text-yellow-500" />
  }
  if (role === "moderator") {
    return <IconShield className="h-3 w-3 text-blue-500" />
  }
  return null
}

function MemberGroup({ title, members, statusColor }: MemberGroupProps) {
  if (members.length === 0) return null

  return (
    <div className="mb-4">
      <h3 className="mb-2 px-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {title} — {members.length}
      </h3>
      <ul className="space-y-0.5">
        {members.map((member) => (
          <li key={member.id}>
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <div className="relative">
                <Avatar size="sm">
                  {member.avatarUrl && (
                    <AvatarImage src={member.avatarUrl} alt={member.displayName ?? ""} />
                  )}
                  <AvatarFallback>
                    {getInitials(member.displayName)}
                  </AvatarFallback>
                </Avatar>
                <span
                  className={cn(
                    "absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-background",
                    statusColor
                  )}
                />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1">
                  <span className="truncate text-sm">
                    {member.displayName ?? "Unknown"}
                  </span>
                  <RoleIcon role={member.role} />
                </div>
                {member.statusMessage && (
                  <p className="truncate text-xs text-muted-foreground">
                    {member.statusMessage}
                  </p>
                )}
              </div>
              {(member.role === "owner" || member.role === "moderator") && (
                <Badge variant={getRoleBadgeVariant(member.role)} className="text-[10px]">
                  {member.role}
                </Badge>
              )}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

function MemberListContent({
  channelId,
  isOpen,
}: {
  readonly channelId: string
  readonly isOpen: boolean
}) {
  const [members, setMembers] = React.useState<{
    online: MemberWithPresence[]
    idle: MemberWithPresence[]
    dnd: MemberWithPresence[]
    offline: MemberWithPresence[]
  } | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    let mounted = true

    async function fetchMembers() {
      try {
        const result = await getChannelMembersWithPresence(channelId)
        if (!mounted) return

        if (result.success) {
          setMembers(result.data)
        } else {
          setError(result.error)
        }
      } catch (err) {
        if (!mounted) return
        setError(err instanceof Error ? err.message : "Failed to load members")
      } finally {
        if (mounted) setLoading(false)
      }
    }

    fetchMembers()

    // 10-second polling interval when sidebar is open
    let pollInterval: ReturnType<typeof setInterval> | null = null
    if (isOpen) {
      pollInterval = setInterval(fetchMembers, 10_000)
    }

    return () => {
      mounted = false
      if (pollInterval) {
        clearInterval(pollInterval)
      }
    }
  }, [channelId, isOpen])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-muted-foreground/20 border-t-muted-foreground" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="px-4 py-8 text-center text-sm text-muted-foreground">
        {error}
      </div>
    )
  }

  if (!members) {
    return (
      <div className="px-4 py-8 text-center text-sm text-muted-foreground">
        No members found
      </div>
    )
  }

  const totalMembers =
    members.online.length +
    members.idle.length +
    members.dnd.length +
    members.offline.length

  return (
    <ScrollArea className="h-full">
      <div className="p-2">
        <div className="mb-4 px-2 text-xs text-muted-foreground">
          {totalMembers} member{totalMembers !== 1 ? "s" : ""}
        </div>

        <MemberGroup
          title="Online"
          members={members.online}
          statusColor={getStatusColor("online")}
        />
        <MemberGroup
          title="Idle"
          members={members.idle}
          statusColor={getStatusColor("idle")}
        />
        <MemberGroup
          title="Do Not Disturb"
          members={members.dnd}
          statusColor={getStatusColor("dnd")}
        />
        <MemberGroup
          title="Offline"
          members={members.offline}
          statusColor={getStatusColor("offline")}
        />
      </div>
    </ScrollArea>
  )
}

export function MemberSidebar({
  channelId,
  isOpen,
  onClose,
}: MemberSidebarProps) {
  return (
    <>
      {/* Desktop sidebar */}
      <aside
        className={cn(
          "hidden w-60 shrink-0 border-l bg-background transition-all duration-200 lg:flex lg:flex-col",
          !isOpen && "w-0 overflow-hidden border-l-0"
        )}
      >
        <div className="flex h-14 shrink-0 items-center justify-between border-b px-4">
          <h2 className="text-sm font-semibold">Members</h2>
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={onClose}
            className="h-6 w-6"
          >
            <IconX className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex-1 overflow-hidden">
          <MemberListContent channelId={channelId} isOpen={isOpen} />
        </div>
      </aside>

      {/* Mobile sheet */}
      <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
        <SheetContent side="right" className="w-72 p-0 lg:hidden">
          <SheetHeader className="h-14 shrink-0 border-b px-4">
            <div className="flex items-center justify-between">
              <SheetTitle className="text-sm">Members</SheetTitle>
            </div>
          </SheetHeader>
          <div className="flex-1 overflow-hidden">
            <MemberListContent channelId={channelId} isOpen={isOpen} />
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}
