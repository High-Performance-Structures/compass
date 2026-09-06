"use client"

import * as React from "react"
import Link from "next/link"
import { IconSparkles } from "@tabler/icons-react"

import { useAgentOptional, useChatStateOptional } from "@/components/agent/chat-provider"
import { buildHelpTopicPrompt } from "@/components/help/help-ui-model"
import { Button } from "@/components/ui/button"
import { MarkdownRenderer } from "@/components/ui/markdown-renderer"
import type { HelpGuideSection } from "@/lib/help"

export function HelpArticle({
  guideId,
  title,
  content,
  sections,
}: {
  readonly guideId: string
  readonly title: string
  readonly content: string
  readonly sections: readonly HelpGuideSection[]
}): React.ReactElement {
  const articleRef = React.useRef<HTMLElement>(null)
  const agent = useAgentOptional()
  const chat = useChatStateOptional()

  React.useEffect(() => {
    const article = articleRef.current
    if (!article) return

    const headings = Array.from(article.querySelectorAll("h2, h3"))
    for (const section of sections) {
      const heading = headings.find(
        (candidate) => candidate.textContent?.trim() === section.title,
      )
      if (heading) heading.id = section.id
    }

    const hash = window.location.hash.slice(1)
    if (!hash) return
    const target = document.getElementById(hash)
    target?.scrollIntoView({ block: "start" })
  }, [sections])

  async function askJarvis(): Promise<void> {
    if (!agent || !chat) return
    agent.open()
    await chat.sendMessage({
      text: buildHelpTopicPrompt({ topicId: guideId, title }),
    })
  }

  return (
    <div className="grid gap-8 py-7 lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-10">
      <aside className="lg:sticky lg:top-20 lg:self-start">
        <p className="text-xs font-semibold uppercase text-muted-foreground">
          In this guide
        </p>
        <ol className="mt-3 space-y-2 border-l border-border pl-3">
          {sections.map((section) => (
            <li key={section.id} className="text-sm leading-5 text-muted-foreground">
              <Link href={`#${section.id}`} className="hover:text-foreground hover:underline">
                {section.title}
              </Link>
            </li>
          ))}
        </ol>
        {agent && chat ? (
          <Button
            variant="ghost"
            size="sm"
            className="mt-4 justify-start px-2"
            onClick={() => void askJarvis()}
          >
            <IconSparkles className="size-4" />
            Ask Jarvis
          </Button>
        ) : null}
      </aside>

      <article
        ref={articleRef}
        className="min-w-0 scroll-mt-20 border-l-2 border-primary/50 pl-5 sm:pl-7 [&_h2]:scroll-mt-20 [&_h2]:border-b [&_h2]:border-border [&_h2]:pb-2 [&_h3]:scroll-mt-20"
      >
        <div className="space-y-4 text-[15px] leading-7 text-foreground [&_h2]:mt-9 [&_h3]:mt-6 [&_li]:leading-6 [&_p]:leading-7">
          <MarkdownRenderer>{content}</MarkdownRenderer>
        </div>
      </article>
    </div>
  )
}
