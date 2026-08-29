"use client"

import { useEffect, useState } from "react"
import {
  IconChevronDown,
  IconHeart,
  IconSparkles,
} from "@tabler/icons-react"

import type { CherishStory } from "@/app/actions/cherish-stories"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

export function CherishStoryArchive({
  items,
  initialStoryId,
}: {
  readonly items: readonly CherishStory[]
  readonly initialStoryId: string | null
}): React.ReactElement {
  const hasInitialStory = initialStoryId !== null &&
    items.some((item) => item.id === initialStoryId)
  const [openStoryId, setOpenStoryId] = useState<string | null>(
    hasInitialStory ? initialStoryId : null,
  )

  useEffect(() => {
    if (!hasInitialStory || initialStoryId === null) return
    document.getElementById(`cherish-${initialStoryId}`)?.scrollIntoView({
      behavior: "auto",
      block: "center",
    })
  }, [hasInitialStory, initialStoryId])

  if (items.length === 0) {
    return (
      <p className="border-y py-8 text-center text-sm text-muted-foreground">
        Approved company Cherishes will collect here.
      </p>
    )
  }

  return (
    <div className="divide-y border-y">
      {items.map((story) => {
        const isOpen = story.id === openStoryId
        return (
          <article
            key={story.id}
            id={`cherish-${story.id}`}
            className={cn(
              "scroll-m-6 px-1 transition-colors",
              isOpen && "bg-muted/30",
            )}
          >
            <button
              type="button"
              className="flex w-full items-center gap-3 px-3 py-4 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
              aria-expanded={isOpen}
              aria-controls={`cherish-story-${story.id}`}
              onClick={() => setOpenStoryId(isOpen ? null : story.id)}
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                <IconSparkles className="size-4" aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold">
                    {story.cherishValue}
                  </span>
                  <Badge variant="outline">
                    {story.responseType === "win" ? "Project win" : "Team shoutout"}
                  </Badge>
                  {story.reactedAt !== null ? (
                    <IconHeart
                      className="size-3.5 fill-current text-primary"
                      aria-label="You loved this story"
                    />
                  ) : null}
                  {story.reactionCount > 0 ? (
                    <span className="text-xs text-muted-foreground">
                      {story.reactionCount} {story.reactionCount === 1 ? "love" : "loves"}
                    </span>
                  ) : null}
                </span>
                <span className="mt-1 block text-xs text-muted-foreground">
                  {formatArchiveDate(story.publishedAt)} · {storyAuthor(story)}
                </span>
              </span>
              <IconChevronDown
                className={cn(
                  "size-4 shrink-0 text-muted-foreground transition-transform",
                  isOpen && "rotate-180",
                )}
                aria-hidden="true"
              />
            </button>
            {isOpen ? (
              <div
                id={`cherish-story-${story.id}`}
                className="px-4 pb-5 pl-15"
              >
                <p className="whitespace-pre-wrap text-base leading-7">
                  {story.message}
                </p>
              </div>
            ) : null}
          </article>
        )
      })}
    </div>
  )
}

function storyAuthor(story: CherishStory): string {
  if (story.isAnonymous) return "Anonymous"
  return story.submittedByName ?? "Team member"
}

function formatArchiveDate(value: string): string {
  return new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}
