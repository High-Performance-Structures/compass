"use client"

import * as React from "react"
import { Check, ChevronsUpDown, Shield, Trash2, UserPlus } from "lucide-react"

import {
  addChannelMember,
  listChannelMembersForManagement,
  removeChannelMember,
  updateChannelMemberRole,
  type ChannelMemberManagementUser,
  type ChannelMemberRole,
} from "@/app/actions/conversations"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { cn } from "@/lib/utils"

type ChannelMemberManagerProps = {
  readonly channelId: string
  readonly channelName: string
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
}

const memberRoles: readonly {
  readonly value: ChannelMemberRole
  readonly label: string
}[] = [
  { value: "member", label: "Member" },
  { value: "moderator", label: "Moderator" },
  { value: "owner", label: "Owner" },
]

function displayName(user: ChannelMemberManagementUser): string {
  return user.displayName ?? user.email
}

function initials(value: string): string {
  const parts = value.trim().split(/\s+/)
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase()
  return `${parts[0].charAt(0)}${parts[parts.length - 1].charAt(0)}`.toUpperCase()
}

function userSearchValue(user: ChannelMemberManagementUser): string {
  return [user.displayName, user.email, user.userRole]
    .filter((value): value is string => Boolean(value))
    .join(" ")
}

function roleLabel(role: ChannelMemberRole | null): string {
  if (role === "owner") return "Owner"
  if (role === "moderator") return "Moderator"
  return "Member"
}

function normalizeMemberRole(value: string): ChannelMemberRole {
  if (value === "owner") return "owner"
  if (value === "moderator") return "moderator"
  return "member"
}

export function ChannelMemberManager({
  channelId,
  channelName,
  open,
  onOpenChange,
}: ChannelMemberManagerProps): React.ReactElement {
  const [users, setUsers] = React.useState<readonly ChannelMemberManagementUser[]>([])
  const [selectedUserId, setSelectedUserId] = React.useState<string | null>(null)
  const [selectedRole, setSelectedRole] = React.useState<ChannelMemberRole>("member")
  const [pickerOpen, setPickerOpen] = React.useState(false)
  const [loading, setLoading] = React.useState(false)
  const [pendingUserId, setPendingUserId] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  const members = users.filter((user) => user.memberRole !== null)
  const availableUsers = users.filter((user) => user.memberRole === null)
  const selectedUser =
    selectedUserId === null
      ? null
      : availableUsers.find((user) => user.userId === selectedUserId) ?? null

  const loadMembers = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    const result = await listChannelMembersForManagement(channelId)
    if (result.success) {
      setUsers(result.data)
      setSelectedUserId((current) =>
        current && result.data.some((user) => user.userId === current && user.memberRole === null)
          ? current
          : null
      )
    } else {
      setError(result.error)
    }
    setLoading(false)
  }, [channelId])

  React.useEffect(() => {
    if (!open) return
    void loadMembers()
  }, [loadMembers, open])

  function handleAddMember(): void {
    if (!selectedUserId) return
    setPendingUserId(selectedUserId)
    setError(null)
    React.startTransition(async () => {
      const result = await addChannelMember(channelId, selectedUserId, selectedRole)
      if (!result.success) {
        setError(result.error)
        setPendingUserId(null)
        return
      }
      setSelectedUserId(null)
      setSelectedRole("member")
      await loadMembers()
      setPendingUserId(null)
    })
  }

  function handleRoleChange(userId: string, role: ChannelMemberRole): void {
    setPendingUserId(userId)
    setError(null)
    React.startTransition(async () => {
      const result = await updateChannelMemberRole(channelId, userId, role)
      if (!result.success) {
        setError(result.error)
        setPendingUserId(null)
        return
      }
      await loadMembers()
      setPendingUserId(null)
    })
  }

  function handleRemove(userId: string): void {
    setPendingUserId(userId)
    setError(null)
    React.startTransition(async () => {
      const result = await removeChannelMember(channelId, userId)
      if (!result.success) {
        setError(result.error)
        setPendingUserId(null)
        return
      }
      await loadMembers()
      setPendingUserId(null)
    })
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-[min(92vw,520px)] overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>Manage channel members</SheetTitle>
          <SheetDescription>
            Add or remove explicit members for #{channelName}. Audience rules
            still control broad staff, owner, or sub/vendor visibility.
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-5 px-4 pb-4">
          <section className="space-y-3 border-y py-4">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <UserPlus className="size-4 text-muted-foreground" />
              Add member
            </div>
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_140px]">
              <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    role="combobox"
                    aria-expanded={pickerOpen}
                    className="justify-between bg-background font-normal"
                    disabled={loading || availableUsers.length === 0}
                  >
                    <span className="truncate">
                      {selectedUser ? displayName(selectedUser) : "Select a person"}
                    </span>
                    <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-[min(420px,calc(100vw-2rem))] p-0">
                  <Command>
                    <CommandInput placeholder="Search name, email, or role..." />
                    <CommandList className="max-h-72 overflow-y-auto">
                      <CommandEmpty>No available users.</CommandEmpty>
                      <CommandGroup>
                        {availableUsers.map((user) => (
                          <CommandItem
                            key={user.userId}
                            value={userSearchValue(user)}
                            onSelect={() => {
                              setSelectedUserId(user.userId)
                              setPickerOpen(false)
                            }}
                          >
                            <Check
                              className={cn(
                                "size-4",
                                selectedUserId === user.userId ? "opacity-100" : "opacity-0"
                              )}
                            />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate font-medium">
                                {displayName(user)}
                              </span>
                              <span className="block truncate text-xs text-muted-foreground">
                                {user.email} · {user.userRole}
                              </span>
                            </span>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
              <Select
                value={selectedRole}
                onValueChange={(value) => setSelectedRole(normalizeMemberRole(value))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {memberRoles.map((role) => (
                    <SelectItem key={role.value} value={role.value}>
                      {role.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              type="button"
              className="w-full sm:w-auto"
              disabled={!selectedUserId || pendingUserId !== null}
              onClick={handleAddMember}
            >
              Add to channel
            </Button>
          </section>

          {error ? (
            <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          ) : null}

          <section className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <Shield className="size-4 text-muted-foreground" />
                Current members
              </div>
              <Badge variant="outline">{members.length}</Badge>
            </div>

            {loading ? (
              <div className="flex min-h-32 items-center justify-center border-y">
                <div className="size-5 animate-spin rounded-full border-2 border-muted-foreground/20 border-t-muted-foreground" />
              </div>
            ) : members.length === 0 ? (
              <div className="border-y py-8 text-center text-sm text-muted-foreground">
                No explicit members yet.
              </div>
            ) : (
              <div className="divide-y border-y">
                {members.map((member) => {
                  const name = displayName(member)
                  return (
                    <div
                      key={member.userId}
                      className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center"
                    >
                      <div className="flex min-w-0 flex-1 items-center gap-3">
                        <Avatar>
                          {member.avatarUrl ? (
                            <AvatarImage src={member.avatarUrl} alt={name} />
                          ) : null}
                          <AvatarFallback>{initials(name)}</AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{name}</p>
                          <p className="truncate text-xs text-muted-foreground">
                            {member.email} · {member.userRole}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 sm:w-56">
                        <Select
                          value={member.memberRole ?? "member"}
                          onValueChange={(value) =>
                            handleRoleChange(member.userId, normalizeMemberRole(value))
                          }
                          disabled={pendingUserId !== null}
                        >
                          <SelectTrigger className="h-9">
                            <SelectValue>{roleLabel(member.memberRole)}</SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            {memberRoles.map((role) => (
                              <SelectItem key={role.value} value={role.value}>
                                {role.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-9 text-muted-foreground hover:text-destructive"
                          disabled={pendingUserId !== null}
                          onClick={() => handleRemove(member.userId)}
                          aria-label={`Remove ${name}`}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </section>
        </div>
      </SheetContent>
    </Sheet>
  )
}
