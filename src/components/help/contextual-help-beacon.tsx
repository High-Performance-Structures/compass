"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { IconBook2, IconSparkles } from "@tabler/icons-react"

import { useAgentOptional, useChatStateOptional } from "@/components/agent/chat-provider"
import { HelpCompassIcon } from "@/components/help/help-compass-icon"
import { buildHelpTopicPrompt } from "@/components/help/help-ui-model"
import { useAuthorizedHelpTopic } from "@/components/help/help-ui-provider"
import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

export function ContextualHelpBeacon({
  topicId,
  className,
}: {
  readonly topicId: string
  readonly className?: string
}): React.ReactElement | null {
  const topic = useAuthorizedHelpTopic(topicId)
  const router = useRouter()
  const agent = useAgentOptional()
  const chat = useChatStateOptional()
  const [open, setOpen] = React.useState(false)

  if (!topic) return null

  const { title, summary } = topic

  async function askJarvis(): Promise<void> {
    if (!agent || !chat) return
    setOpen(false)
    agent.open()
    await chat.sendMessage({
      text: buildHelpTopicPrompt({ topicId, title }),
    })
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button
              type="button"
              className={cn(
                "inline-flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground/70 outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
                className,
              )}
              aria-label={`Help: ${title}`}
              onDoubleClick={() => router.push(topic.href)}
            >
              <HelpCompassIcon className="size-3.5" />
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs" sideOffset={5}>
          {summary}
        </TooltipContent>
      </Tooltip>

      <PopoverContent align="start" className="w-80 max-w-[calc(100vw-2rem)]">
        <PopoverHeader>
          <PopoverTitle>{title}</PopoverTitle>
          <PopoverDescription className="leading-5">{summary}</PopoverDescription>
        </PopoverHeader>
        <div className="mt-4 flex flex-col gap-2">
          <Button variant="outline" size="sm" asChild className="justify-start">
            <Link href={topic.href} onClick={() => setOpen(false)}>
              <IconBook2 className="size-4" />
              Read full guide
            </Link>
          </Button>
          {agent && chat ? (
            <Button
              variant="ghost"
              size="sm"
              className="justify-start"
              onClick={() => void askJarvis()}
            >
              <IconSparkles className="size-4" />
              Ask Jarvis about this
            </Button>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  )
}
