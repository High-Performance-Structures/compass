"use client"

import * as React from "react"
import { formatDistanceToNow, format, parseISO } from "date-fns"
import { IconHash, IconUser, IconCalendar, IconSearch, IconLoader2 } from "@tabler/icons-react"
import {
  CommandDialog,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Calendar } from "@/components/ui/calendar"
import { cn } from "@/lib/utils"
import { searchMessages } from "@/app/actions/message-search"
import { listChannels } from "@/app/actions/conversations"
import { getUsers } from "@/app/actions/users"

type SearchResultMessage = {
  id: string
  content: string
  channelId: string
  channelName: string
  createdAt: string
  user: {
    id: string
    displayName: string | null
    avatarUrl: string | null
  }
}

type Channel = {
  id: string
  name: string
}

type User = {
  id: string
  displayName: string | null
  email: string
  avatarUrl: string | null
}

type SearchDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onJumpToMessage: (messageId: string, channelId: string) => void
}

export function SearchDialog({
  open,
  onOpenChange,
  onJumpToMessage,
}: SearchDialogProps) {
  const [query, setQuery] = React.useState("")
  const [debouncedQuery, setDebouncedQuery] = React.useState("")
  const [results, setResults] = React.useState<SearchResultMessage[]>([])
  const [isLoading, setIsLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  // filter state
  const [channels, setChannels] = React.useState<Channel[]>([])
  const [users, setUsers] = React.useState<User[]>([])
  const [selectedChannel, setSelectedChannel] = React.useState<string>("all")
  const [selectedUser, setSelectedUser] = React.useState<string>("all")
  const [startDate, setStartDate] = React.useState<Date | undefined>()
  const [endDate, setEndDate] = React.useState<Date | undefined>()

  // load channels and users on mount
  React.useEffect(() => {
    async function loadFilters() {
      const [channelsResult, usersResult] = await Promise.all([
        listChannels(),
        getUsers(),
      ])
      if (channelsResult.success && channelsResult.data) {
        setChannels(channelsResult.data)
      }
      if (usersResult) {
        setUsers(usersResult)
      }
    }
    loadFilters()
  }, [])

  // debounce query
  React.useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(query)
    }, 300)
    return () => clearTimeout(timer)
  }, [query])

  // search when debounced query changes
  React.useEffect(() => {
    async function performSearch() {
      if (!debouncedQuery.trim()) {
        setResults([])
        return
      }

      setIsLoading(true)
      setError(null)

      const filters: {
        channelId?: string
        userId?: string
        startDate?: string
        endDate?: string
      } = {}

      if (selectedChannel !== "all") filters.channelId = selectedChannel
      if (selectedUser !== "all") filters.userId = selectedUser
      if (startDate) filters.startDate = startDate.toISOString()
      if (endDate) filters.endDate = endDate.toISOString()

      const result = await searchMessages(debouncedQuery, filters)

      if (result.success) {
        setResults(result.data)
      } else {
        setError(result.error)
        setResults([])
      }

      setIsLoading(false)
    }

    if (open) {
      performSearch()
    }
  }, [debouncedQuery, selectedChannel, selectedUser, startDate, endDate, open])

  // reset state when dialog closes
  React.useEffect(() => {
    if (!open) {
      setQuery("")
      setDebouncedQuery("")
      setResults([])
      setError(null)
    }
  }, [open])

  const handleJumpToMessage = (message: SearchResultMessage) => {
    onJumpToMessage(message.id, message.channelId)
    onOpenChange(false)
  }

  const clearFilters = () => {
    setSelectedChannel("all")
    setSelectedUser("all")
    setStartDate(undefined)
    setEndDate(undefined)
  }

  const hasActiveFilters =
    selectedChannel !== "all" ||
    selectedUser !== "all" ||
    startDate !== undefined ||
    endDate !== undefined

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Search Messages"
      description="Search across all your conversations"
    >
      <div className="border-b px-3 py-2">
        <div className="flex items-center gap-2">
          <IconSearch className="size-4 shrink-0 text-muted-foreground" />
          <input
            placeholder="Search messages..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            autoFocus
          />
          {isLoading && <IconLoader2 className="size-4 animate-spin text-muted-foreground" />}
        </div>
      </div>

      <div className="flex items-center gap-2 border-b px-3 py-2">
        <Select value={selectedChannel} onValueChange={setSelectedChannel}>
          <SelectTrigger size="sm" className="h-7 text-xs">
            <IconHash className="mr-1 size-3" />
            <SelectValue placeholder="Channel" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Channels</SelectItem>
            {channels.map((channel) => (
              <SelectItem key={channel.id} value={channel.id}>
                {channel.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={selectedUser} onValueChange={setSelectedUser}>
          <SelectTrigger size="sm" className="h-7 text-xs">
            <IconUser className="mr-1 size-3" />
            <SelectValue placeholder="User" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Users</SelectItem>
            {users.map((user) => (
              <SelectItem key={user.id} value={user.id}>
                {user.displayName ?? user.email.split("@")[0]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className={cn(
                "h-7 text-xs",
                (startDate || endDate) && "border-primary"
              )}
            >
              <IconCalendar className="mr-1 size-3" />
              {startDate || endDate ? "Date set" : "Date"}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-2" align="start">
            <div className="space-y-2">
              <div className="text-xs font-medium">From</div>
              <Calendar
                mode="single"
                selected={startDate}
                onSelect={setStartDate}
                className="rounded-md border"
              />
              <div className="text-xs font-medium">To</div>
              <Calendar
                mode="single"
                selected={endDate}
                onSelect={setEndDate}
                className="rounded-md border"
              />
            </div>
          </PopoverContent>
        </Popover>

        {hasActiveFilters && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={clearFilters}
          >
            Clear
          </Button>
        )}
      </div>

      <CommandList className="max-h-[400px]">
        {error && (
          <div className="p-4 text-center text-sm text-destructive">{error}</div>
        )}
        {!error && !isLoading && debouncedQuery && results.length === 0 && (
          <CommandEmpty>No messages found.</CommandEmpty>
        )}
        {results.length > 0 && (
          <CommandGroup heading="Results">
            {results.map((message) => {
              const displayName =
                message.user.displayName ?? "Unknown User"
              const avatarFallback = displayName.substring(0, 2).toUpperCase()
              const timestamp = parseISO(message.createdAt)
              const isRecent =
                Date.now() - timestamp.getTime() < 24 * 60 * 60 * 1000
              const timeDisplay = isRecent
                ? formatDistanceToNow(timestamp, { addSuffix: true })
                : format(timestamp, "MMM d, yyyy")

              return (
                <CommandItem
                  key={message.id}
                  value={message.id}
                  onSelect={() => handleJumpToMessage(message)}
                  className="flex items-start gap-3 py-3"
                >
                  <Avatar className="mt-0.5 h-8 w-8 shrink-0">
                    {message.user.avatarUrl && (
                      <AvatarImage
                        src={message.user.avatarUrl}
                        alt={displayName}
                      />
                    )}
                    <AvatarFallback className="text-xs">
                      {avatarFallback}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1 overflow-hidden">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{displayName}</span>
                      <span className="text-xs text-muted-foreground">
                        in #{message.channelName}
                      </span>
                    </div>
                    <p className="mt-0.5 truncate text-sm text-muted-foreground">
                      {message.content}
                    </p>
                    <span className="text-xs text-muted-foreground">
                      {timeDisplay}
                    </span>
                  </div>
                </CommandItem>
              )
            })}
          </CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  )
}
