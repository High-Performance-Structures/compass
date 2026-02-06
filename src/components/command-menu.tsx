"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { useTheme } from "next-themes"
import {
  IconDashboard,
  IconFolder,
  IconFiles,
  IconCalendarStats,
  IconMessageCircle,
  IconSun,
  IconSearch,
} from "@tabler/icons-react"
import { useAgentOptional } from "@/components/agent/chat-provider"

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"

export function CommandMenu({
  open,
  setOpen,
  initialQuery = "",
}: {
  readonly open: boolean
  readonly setOpen: (open: boolean) => void
  readonly initialQuery?: string
}) {
  const router = useRouter()
  const { theme, setTheme } = useTheme()
  const agent = useAgentOptional()
  const [query, setQuery] = React.useState("")

  React.useEffect(() => {
    if (open) {
      setQuery(initialQuery)
    }
  }, [open, initialQuery])

  React.useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setOpen(!open)
      }
    }
    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  }, [open, setOpen])

  function runCommand(cmd: () => void) {
    setOpen(false)
    cmd()
  }

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput
        placeholder="Type a command or search..."
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        <CommandGroup heading="Navigation">
          <CommandItem onSelect={() => runCommand(() => router.push("/dashboard"))}>
            <IconDashboard />
            Dashboard
          </CommandItem>
          <CommandItem onSelect={() => runCommand(() => router.push("/dashboard/projects"))}>
            <IconFolder />
            Projects
          </CommandItem>
          <CommandItem onSelect={() => runCommand(() => router.push("/dashboard/files"))}>
            <IconFiles />
            Files
          </CommandItem>
          <CommandItem onSelect={() => runCommand(() => router.push("/dashboard/projects/demo-project-1/schedule"))}>
            <IconCalendarStats />
            Schedule
          </CommandItem>
        </CommandGroup>
        <CommandGroup heading="Actions">
          {agent && (
            <CommandItem onSelect={() => runCommand(() => agent.open())}>
              <IconMessageCircle />
              Ask Assistant
            </CommandItem>
          )}
          <CommandItem onSelect={() => runCommand(() => setTheme(theme === "dark" ? "light" : "dark"))}>
            <IconSun />
            Toggle theme
          </CommandItem>
          <CommandItem onSelect={() => runCommand(() => setOpen(true))}>
            <IconSearch />
            Search files
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  )
}
