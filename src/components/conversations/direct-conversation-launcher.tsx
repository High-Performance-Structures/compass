"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Check, ChevronsUpDown, MessageSquarePlus } from "lucide-react"

import {
  listConversationUsers,
  openDirectConversation,
  type ConversationUserOption,
} from "@/app/actions/conversations"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
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
import { cn } from "@/lib/utils"

function displayName(user: ConversationUserOption): string {
  return user.displayName ?? user.email.split("@")[0] ?? user.email
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("")
}

function userSearchValue(user: ConversationUserOption): string {
  return [user.displayName, user.email, user.role]
    .filter((value): value is string => Boolean(value))
    .join(" ")
}

export function DirectConversationLauncher(): React.ReactElement {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [loading, setLoading] = React.useState(false)
  const [startingUserId, setStartingUserId] = React.useState<string | null>(null)
  const [users, setUsers] = React.useState<readonly ConversationUserOption[]>([])
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!open || users.length > 0 || loading) return
    setLoading(true)
    listConversationUsers()
      .then((result) => {
        if (result.success) {
          setUsers(result.data)
          setError(null)
        } else {
          setError(result.error)
        }
      })
      .finally(() => setLoading(false))
  }, [loading, open, users.length])

  const handleSelect = React.useCallback(
    (userId: string) => {
      setStartingUserId(userId)
      setError(null)
      openDirectConversation(userId)
        .then((result) => {
          if (result.success) {
            setOpen(false)
            router.push(`/dashboard/conversations/${result.data.channelId}`)
            router.refresh()
          } else {
            setError(result.error)
          }
        })
        .finally(() => setStartingUserId(null))
    },
    [router]
  )

  return (
    <div className="space-y-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="w-full justify-between"
          >
            <span className="flex min-w-0 items-center gap-2">
              <MessageSquarePlus className="size-4 shrink-0 text-muted-foreground" />
              <span className="truncate">Start a direct message</span>
            </span>
            <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-[min(420px,calc(100vw-2rem))] p-0"
        >
          <Command>
            <CommandInput placeholder="Search by name, email, or role..." />
            <CommandList className="max-h-80 overflow-y-auto">
              <CommandEmpty>
                {loading ? "Loading users..." : "No matching users."}
              </CommandEmpty>
              <CommandGroup heading="Compass users">
                {users.map((user) => {
                  const name = displayName(user)
                  const starting = startingUserId === user.userId
                  return (
                    <CommandItem
                      key={user.userId}
                      value={userSearchValue(user)}
                      disabled={startingUserId !== null}
                      onSelect={() => handleSelect(user.userId)}
                      className="items-center gap-2 py-2"
                    >
                      <Avatar className="size-7">
                        {user.avatarUrl ? (
                          <AvatarImage src={user.avatarUrl} alt={name} />
                        ) : null}
                        <AvatarFallback className="text-[11px]">
                          {initials(name)}
                        </AvatarFallback>
                      </Avatar>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">
                          {name}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {user.email}
                        </span>
                      </span>
                      <Check
                        className={cn(
                          "size-4",
                          starting ? "opacity-100" : "opacity-0"
                        )}
                      />
                    </CommandItem>
                  )
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  )
}
