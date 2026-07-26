"use client"

import * as React from "react"
import { usePathname, useRouter } from "next/navigation"
import { useTheme } from "@/components/theme-provider"
import {
  IconAddressBook,
  IconAutomation,
  IconDashboard,
  IconFolder,
  IconFiles,
  IconReceipt,
  IconCalendarStats,
  IconMessageCircle,
  IconSettings,
  IconSun,
  IconSparkles,
} from "@tabler/icons-react"
import {
  useAgentOptional,
  useChatStateOptional,
} from "@/components/agent/chat-provider"

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
  canUseAskCompass,
}: {
  readonly open: boolean
  readonly setOpen: (open: boolean) => void
  readonly initialQuery?: string
  readonly canUseAskCompass: boolean
}) {
  const router = useRouter()
  const pathname = usePathname()
  const { theme, setTheme } = useTheme()
  const agent = useAgentOptional()
  const chat = useChatStateOptional()
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

  function askAgent(): void {
    if (!canUseAskCompass) return

    const prompt = query.trim()
    if (!prompt) return

    agent?.open()
    chat?.sendMessage({ text: prompt })
  }

  function schedulePath(): string {
    const match = pathname?.match(/^\/dashboard\/projects\/([^/]+)/)
    return match
      ? `/dashboard/projects/${match[1]}/schedule`
      : "/dashboard/projects/select?target=schedule"
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
          <CommandItem onSelect={() => runCommand(() => router.push(schedulePath()))}>
            <IconCalendarStats />
            Work Calendar
          </CommandItem>
          <CommandItem onSelect={() => runCommand(() => router.push("/dashboard/conversations"))}>
            <IconMessageCircle />
            Conversations
          </CommandItem>
          <CommandItem onSelect={() => runCommand(() => router.push("/dashboard/contacts"))}>
            <IconAddressBook />
            Contacts
          </CommandItem>
          <CommandItem onSelect={() => runCommand(() => router.push("/dashboard/financials"))}>
            <IconReceipt />
            Financials
          </CommandItem>
          <CommandItem onSelect={() => runCommand(() => router.push("/dashboard/automations"))}>
            <IconAutomation />
            Automations
          </CommandItem>
          <CommandItem onSelect={() => runCommand(() => router.push("/dashboard/settings"))}>
            <IconSettings />
            Settings
          </CommandItem>
        </CommandGroup>
        <CommandGroup heading="Actions">
          {canUseAskCompass && query.trim() && agent && chat && (
            <CommandItem
              value={`ask jarvis ${query}`}
              onSelect={() => runCommand(askAgent)}
            >
              <IconSparkles />
              Ask Jarvis: {query}
            </CommandItem>
          )}
          {canUseAskCompass && agent && (
            <CommandItem onSelect={() => runCommand(() => agent.open())}>
              <IconMessageCircle />
              Open Jarvis
            </CommandItem>
          )}
          <CommandItem onSelect={() => runCommand(() => setTheme(theme === "dark" ? "light" : "dark"))}>
            <IconSun />
            Toggle theme
          </CommandItem>
          <CommandItem onSelect={() => runCommand(() => router.push("/dashboard/files"))}>
            <IconFiles />
            Open files
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  )
}
