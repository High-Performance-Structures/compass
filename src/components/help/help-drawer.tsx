"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  IconArrowRight,
  IconBook2,
  IconMail,
  IconPhone,
  IconSearch,
  IconSparkles,
} from "@tabler/icons-react"

import { useAgentOptional, useChatStateOptional } from "@/components/agent/chat-provider"
import { HelpCompassIcon } from "@/components/help/help-compass-icon"
import {
  helpGuidesForPathname,
  searchAllowedHelpGuides,
} from "@/components/help/help-ui-model"
import {
  useAllowedHelpGuides,
  useCanUseHelpJarvis,
} from "@/components/help/help-ui-provider"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"

export function HelpDrawer({
  triggerClassName,
}: {
  readonly triggerClassName?: string
}): React.ReactElement {
  const pathname = usePathname()
  const agent = useAgentOptional()
  const chat = useChatStateOptional()
  const canUseJarvis = useCanUseHelpJarvis()
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState("")
  const accessibleGuides = useAllowedHelpGuides()
  const suggestedGuides = React.useMemo(
    () => helpGuidesForPathname(accessibleGuides, pathname),
    [accessibleGuides, pathname],
  )
  const searchResults = React.useMemo(
    () => searchAllowedHelpGuides(accessibleGuides, query, 20),
    [accessibleGuides, query],
  )
  const shownResults =
    query.trim().length > 0
      ? searchResults
      : (suggestedGuides.length > 0 ? suggestedGuides : accessibleGuides).map(
          (guide) => ({
            guide,
            href: `/dashboard/help/${guide.slug}`,
          }),
        )
  const showingSuggestions = query.trim().length === 0 && suggestedGuides.length > 0

  async function askJarvis(): Promise<void> {
    const question = query.trim()
    if (!question || !canUseJarvis || !agent || !chat) return
    setOpen(false)
    agent.open()
    await chat.sendMessage({
      text: `Using the official Compass Help guide, help me with this question about the page I am viewing: ${question}`,
    })
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <SheetTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={triggerClassName}
                aria-label="Open Compass Help"
              >
                <HelpCompassIcon />
              </Button>
            </SheetTrigger>
          </TooltipTrigger>
          <TooltipContent side="bottom">Compass Help</TooltipContent>
        </Tooltip>
      </TooltipProvider>

      <SheetContent className="w-full gap-0 sm:max-w-lg" aria-label="Compass Help">
        <SheetHeader className="border-b border-border px-5 pb-4 pt-5">
          <div className="flex items-center gap-2 text-primary">
            <HelpCompassIcon className="size-5" />
            <SheetTitle>Compass Help</SheetTitle>
          </div>
          <SheetDescription>
            Search the official user guide without leaving your work.
          </SheetDescription>
          <div className="relative pt-2">
            <IconSearch className="pointer-events-none absolute left-3 top-1/2 mt-1 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && shownResults.length === 0) {
                  void askJarvis()
                }
              }}
              placeholder="What are you trying to do?"
              aria-label="Search Compass Help"
              className="pl-9"
              autoComplete="off"
              autoFocus
            />
          </div>
        </SheetHeader>

        <ScrollArea className="min-h-0 flex-1">
          <div className="px-5 py-4">
            <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground" aria-live="polite">
              {showingSuggestions
                ? "Help for this page"
                : query.trim().length > 0
                  ? `${shownResults.length} ${shownResults.length === 1 ? "result" : "results"}`
                  : "Browse the guide"}
            </p>

            {shownResults.length > 0 ? (
              <div className="divide-y divide-border">
                {shownResults.map((result) => (
                  <Link
                    key={result.guide.slug}
                    href={result.href}
                    onClick={() => setOpen(false)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group block py-4 first:pt-2"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <p className="font-medium text-foreground group-hover:text-primary">
                          {result.guide.title}
                        </p>
                        <p className="mt-1 text-sm leading-5 text-muted-foreground">
                          {result.guide.summary}
                        </p>
                        <p className="mt-2 text-xs text-muted-foreground">
                          {result.guide.category} · {result.guide.readingMinutes} min
                        </p>
                      </div>
                      <IconArrowRight className="mt-1 size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-primary" />
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="py-10 text-center">
                <IconSearch className="mx-auto size-6 text-muted-foreground" />
                <p className="mt-3 font-medium">No matching guide yet</p>
                <p className="mt-1 text-sm leading-5 text-muted-foreground">
                  {canUseJarvis && agent && chat
                    ? "Try another term, or let Jarvis use the official guide and this page as context."
                    : "Try another term, browse the full guide, or email Compass Help."}
                </p>
                {canUseJarvis && agent && chat && query.trim().length > 0 ? (
                  <Button className="mt-4" onClick={() => void askJarvis()}>
                    <IconSparkles className="size-4" />
                    Ask Jarvis about this
                  </Button>
                ) : null}
              </div>
            )}
          </div>
        </ScrollArea>

        <div className="flex items-center justify-between gap-3 border-t border-border px-5 py-3">
          <Button variant="ghost" size="sm" asChild>
            <Link
              href="/dashboard/help"
              onClick={() => setOpen(false)}
              target="_blank"
              rel="noopener noreferrer"
            >
              <IconBook2 className="size-4" />
              Open full guide
            </Link>
          </Button>
          {query.trim().length > 0 && canUseJarvis && agent && chat ? (
            <Button variant="ghost" size="sm" onClick={() => void askJarvis()}>
              <IconSparkles className="size-4" />
              Ask Jarvis
            </Button>
          ) : (
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="sm" asChild>
                <a
                  href="mailto:compasshelp@hps-colorado.com?subject=Compass%20Help%20Request"
                  onClick={() => setOpen(false)}
                >
                  <IconMail className="size-4" />
                  Email
                </a>
              </Button>
              <Button variant="ghost" size="sm" asChild>
                <a
                  href="tel:+17198966149"
                  aria-label="Call Compass Help at 719-896-6149"
                  onClick={() => setOpen(false)}
                >
                  <IconPhone className="size-4" />
                  Call
                </a>
              </Button>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
