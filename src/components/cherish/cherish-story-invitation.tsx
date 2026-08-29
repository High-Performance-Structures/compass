"use client"

import Link from "next/link"
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useTransition,
} from "react"
import {
  IconChevronLeft,
  IconChevronRight,
  IconHeart,
  IconHeartHandshake,
  IconPlayerPause,
  IconPlayerPlay,
  IconSend,
  IconShare3,
  IconSparkles,
} from "@tabler/icons-react"

import {
  deleteCherishStoryReply,
  markCherishStoryViewed,
  sendCherishStoryReply,
  setCherishStoryReaction,
  type CherishStory,
} from "@/app/actions/cherish-stories"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"

const STORY_DURATION_MS = 8_000
const STORY_TICK_MS = 100

export function CherishStoryInvitation({
  items,
  className,
}: {
  readonly items: readonly CherishStory[]
  readonly className?: string
}): React.ReactElement | null {
  const [stories, setStories] = useState(items)
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const [progress, setProgress] = useState(0)
  const [paused, setPaused] = useState(false)
  const [reducedMotion, setReducedMotion] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [replyDraft, setReplyDraft] = useState("")
  const [replyFocused, setReplyFocused] = useState(false)
  const [lastReply, setLastReply] = useState<{
    readonly id: string
    readonly storyId: string
  } | null>(null)
  const [isReacting, startReactionTransition] = useTransition()
  const [isReplying, startReplyTransition] = useTransition()
  const unreadCount = stories.filter((story) => story.viewedAt === null).length
  const currentStory = stories[activeIndex]

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)")
    function updateMotionPreference(): void {
      setReducedMotion(mediaQuery.matches)
      if (mediaQuery.matches) setPaused(true)
    }

    updateMotionPreference()
    mediaQuery.addEventListener("change", updateMotionPreference)
    return () => mediaQuery.removeEventListener("change", updateMotionPreference)
  }, [])

  const showStory = useCallback((index: number): void => {
    setActiveIndex(index)
    setProgress(0)
    setStatus(null)
    setReplyDraft("")
  }, [])

  const closeStories = useCallback((): void => {
    setOpen(false)
    setProgress(0)
    setStatus(null)
  }, [])

  const showNextStory = useCallback((): void => {
    if (activeIndex >= stories.length - 1) {
      closeStories()
      return
    }
    showStory(activeIndex + 1)
  }, [activeIndex, closeStories, showStory, stories.length])

  const showPreviousStory = useCallback((): void => {
    if (activeIndex === 0) {
      setProgress(0)
      return
    }
    showStory(activeIndex - 1)
  }, [activeIndex, showStory])

  useEffect(() => {
    if (!open || paused || reducedMotion || replyFocused || !currentStory) return

    const timer = window.setInterval(() => {
      setProgress((current) =>
        Math.min(100, current + (STORY_TICK_MS / STORY_DURATION_MS) * 100),
      )
    }, STORY_TICK_MS)
    return () => window.clearInterval(timer)
  }, [currentStory, open, paused, reducedMotion, replyFocused])

  useEffect(() => {
    if (progress < 100) return
    showNextStory()
  }, [progress, showNextStory])

  useEffect(() => {
    if (!open || !currentStory || currentStory.viewedAt !== null) return

    const viewedAt = new Date().toISOString()
    setStories((current) =>
      current.map((story) =>
        story.id === currentStory.id ? { ...story, viewedAt } : story,
      ),
    )
    void markCherishStoryViewed({ id: currentStory.id }).then((result) => {
      if (!result.success) setStatus(result.error)
    })
  }, [currentStory, open])

  const firstStoryIndex = useMemo(() => {
    const unreadIndex = stories.findIndex((story) => story.viewedAt === null)
    return unreadIndex === -1 ? 0 : unreadIndex
  }, [stories])

  if (stories.length === 0) return null

  function openStories(): void {
    showStory(firstStoryIndex)
    setPaused(reducedMotion)
    setOpen(true)
  }

  function updateReaction(): void {
    if (!currentStory) return
    const nextReacted = currentStory.reactedAt === null
    const optimisticReactedAt = nextReacted ? new Date().toISOString() : null
    setStories((current) =>
      current.map((story) =>
        story.id === currentStory.id
          ? {
              ...story,
              reactedAt: optimisticReactedAt,
              reactionCount: Math.max(
                0,
                story.reactionCount + (nextReacted ? 1 : -1),
              ),
            }
          : story,
      ),
    )

    startReactionTransition(async () => {
      const result = await setCherishStoryReaction({
        id: currentStory.id,
        reacted: nextReacted,
      })
      if (result.success) {
        setStories((current) =>
          current.map((story) =>
            story.id === currentStory.id
              ? { ...story, reactedAt: result.data.reactedAt }
              : story,
          ),
        )
        setStatus(nextReacted ? "Reaction sent." : "Reaction removed.")
        return
      }

      setStories((current) =>
        current.map((story) =>
          story.id === currentStory.id
            ? {
                ...story,
                reactedAt: currentStory.reactedAt,
                reactionCount: currentStory.reactionCount,
              }
            : story,
        ),
      )
      setStatus(result.error)
    })
  }

  async function shareStory(): Promise<void> {
    if (!currentStory) return
    const shareUrl = new URL("/dashboard/cherish", window.location.origin)
    shareUrl.searchParams.set("story", currentStory.id)
    const shareData = {
      title: `CHERISH · ${currentStory.cherishValue}`,
      text: "A CHERISH story was shared with you in Compass.",
      url: shareUrl.toString(),
    }

    try {
      if (navigator.share) {
        await navigator.share(shareData)
        setStatus("Story shared.")
      } else {
        await navigator.clipboard.writeText(shareData.url)
        setStatus("Story link copied.")
      }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return
      setStatus("Unable to share this story right now.")
    }
  }

  function sendReply(): void {
    if (!currentStory) return
    const message = replyDraft.trim()
    if (message.length === 0) {
      setStatus("Write a brief reply first.")
      return
    }

    startReplyTransition(async () => {
      const result = await sendCherishStoryReply({
        id: currentStory.id,
        message,
      })
      if (!result.success) {
        setStatus(result.error)
        return
      }

      setReplyDraft("")
      setLastReply({ id: result.data.id, storyId: currentStory.id })
      setStatus("Reply sent privately.")
    })
  }

  function removeLastReply(): void {
    if (!lastReply) return
    startReplyTransition(async () => {
      const result = await deleteCherishStoryReply({ id: lastReply.id })
      if (!result.success) {
        setStatus(result.error)
        return
      }
      setLastReply(null)
      setStatus("Reply removed.")
    })
  }

  return (
    <>
      <section
        className={cn(
          "border-y bg-muted/20 px-3 py-3 sm:px-4",
          className,
        )}
        aria-label="CHERISH stories"
      >
        <button
          type="button"
          onClick={openStories}
          className="flex w-full items-center gap-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          aria-label={
            unreadCount > 0
              ? `Open ${unreadCount} new CHERISH ${unreadCount === 1 ? "story" : "stories"}`
              : "Replay today's CHERISH stories"
          }
        >
          <span
            className={cn(
              "flex size-12 shrink-0 items-center justify-center rounded-full border-2 bg-background",
              unreadCount > 0 ? "border-primary" : "border-muted-foreground/40",
            )}
            aria-hidden="true"
          >
            <IconHeartHandshake className="size-6 text-primary" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5 text-sm font-semibold">
              {unreadCount > 0 ? "New CHERISH story" : "Today’s CHERISH"}
              {unreadCount > 0 ? (
                <IconSparkles className="size-4 text-primary" aria-hidden="true" />
              ) : null}
            </span>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              {unreadCount > 0
                ? `${unreadCount} ${unreadCount === 1 ? "moment is" : "moments are"} ready for you`
                : "Replay today’s company stories before they expire"}
            </span>
          </span>
          <span className="shrink-0 text-xs font-medium text-primary">
            {unreadCount > 0 ? "Watch" : "Replay"}
          </span>
        </button>
      </section>

      <Dialog open={open} onOpenChange={(nextOpen) => {
        if (nextOpen) setOpen(true)
        else closeStories()
      }}>
        <DialogContent
          showCloseButton
          className="h-[min(44rem,calc(100dvh-2rem))] max-w-md overflow-hidden border-0 bg-primary p-0 text-primary-foreground shadow-2xl"
          onKeyDown={(event) => {
            const target = event.target
            if (
              target instanceof HTMLElement &&
              target.closest("button, input, textarea, select")
            ) {
              return
            }
            if (event.key === "ArrowLeft") showPreviousStory()
            if (event.key === "ArrowRight") showNextStory()
            if (event.key === " ") {
              event.preventDefault()
              setPaused((current) => !current)
            }
          }}
        >
          <DialogTitle className="sr-only">CHERISH stories</DialogTitle>
          <DialogDescription className="sr-only">
            Company recognition published during the last 24 hours. Use the
            previous and next buttons or arrow keys to move between stories.
          </DialogDescription>

          {currentStory ? (
            <article className="relative flex h-full min-h-0 flex-col">
              <div className="absolute inset-x-0 top-0 z-10 space-y-3 p-4 pr-12">
                <div className="flex gap-1" aria-hidden="true">
                  {stories.map((story, index) => (
                    <span
                      key={story.id}
                      className="h-1 flex-1 overflow-hidden bg-primary-foreground/30"
                    >
                      <span
                        className="block h-full bg-primary-foreground transition-[width] duration-100"
                        style={{
                          width: `${
                            index < activeIndex
                              ? 100
                              : index > activeIndex
                                ? 0
                                : progress
                          }%`,
                        }}
                      />
                    </span>
                  ))}
                </div>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary-foreground/75">
                      CHERISH · {currentStory.cherishValue}
                    </p>
                    <p className="mt-1 text-xs text-primary-foreground/75">
                      {currentStory.responseType === "win" ? "Project win" : "Team shoutout"}
                      {" · "}
                      {formatStoryAge(currentStory.publishedAt)}
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    className="rounded-full text-primary-foreground hover:bg-primary-foreground/15 hover:text-primary-foreground"
                    onClick={() => setPaused((current) => !current)}
                    aria-label={paused ? "Play story" : "Pause story"}
                  >
                    {paused ? (
                      <IconPlayerPlay aria-hidden="true" />
                    ) : (
                      <IconPlayerPause aria-hidden="true" />
                    )}
                  </Button>
                </div>
              </div>

              <div className="flex min-h-0 flex-1 items-center overflow-y-auto px-12 pb-40 pt-28">
                <div className="w-full">
                  <IconSparkles
                    className="mb-5 size-7 text-primary-foreground/70"
                    aria-hidden="true"
                  />
                  <p className="whitespace-pre-wrap text-balance text-2xl font-semibold leading-snug sm:text-3xl">
                    {currentStory.message}
                  </p>
                  <p className="mt-6 text-sm text-primary-foreground/75">
                    — {storyAuthor(currentStory)}
                  </p>
                </div>
              </div>

              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="absolute left-1 top-1/2 rounded-full text-primary-foreground hover:bg-primary-foreground/15 hover:text-primary-foreground"
                onClick={showPreviousStory}
                disabled={activeIndex === 0}
                aria-label="Previous CHERISH story"
              >
                <IconChevronLeft aria-hidden="true" />
              </Button>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="absolute right-1 top-1/2 rounded-full text-primary-foreground hover:bg-primary-foreground/15 hover:text-primary-foreground"
                onClick={showNextStory}
                aria-label={
                  activeIndex === stories.length - 1
                    ? "Finish CHERISH stories"
                    : "Next CHERISH story"
                }
              >
                <IconChevronRight aria-hidden="true" />
              </Button>

              <footer className="absolute inset-x-0 bottom-0 border-t border-primary-foreground/20 bg-primary px-4 py-3">
                <form
                  className="mb-2 flex items-center gap-2"
                  onSubmit={(event) => {
                    event.preventDefault()
                    sendReply()
                  }}
                >
                  <Input
                    value={replyDraft}
                    onChange={(event) => setReplyDraft(event.target.value)}
                    onFocus={() => setReplyFocused(true)}
                    onBlur={() => setReplyFocused(false)}
                    maxLength={300}
                    placeholder="Reply privately…"
                    aria-label="Reply privately to this CHERISH story"
                    className="border-primary-foreground/30 bg-primary-foreground/10 text-primary-foreground placeholder:text-primary-foreground/60"
                  />
                  <Button
                    type="submit"
                    size="icon"
                    variant="secondary"
                    disabled={isReplying || replyDraft.trim().length === 0}
                    aria-label="Send private reply"
                  >
                    <IconSend aria-hidden="true" />
                  </Button>
                </form>
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="text-primary-foreground hover:bg-primary-foreground/15 hover:text-primary-foreground"
                      onClick={updateReaction}
                      disabled={isReacting}
                      aria-pressed={currentStory.reactedAt !== null}
                    >
                      <IconHeart
                        className={cn(
                          currentStory.reactedAt !== null && "fill-current",
                        )}
                        aria-hidden="true"
                      />
                      {currentStory.reactedAt !== null ? "Loved" : "Love this"}
                      {currentStory.reactionCount > 0
                        ? ` · ${currentStory.reactionCount}`
                        : ""}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="text-primary-foreground hover:bg-primary-foreground/15 hover:text-primary-foreground"
                      onClick={() => void shareStory()}
                    >
                      <IconShare3 aria-hidden="true" /> Share
                    </Button>
                  </div>
                  <Button
                    asChild
                    size="sm"
                    variant="ghost"
                    className="text-primary-foreground hover:bg-primary-foreground/15 hover:text-primary-foreground"
                  >
                    <Link href="/dashboard/cherish">CHERISH tab</Link>
                  </Button>
                </div>
                <div className="flex min-h-5 items-center gap-2 px-2 pt-1 text-xs text-primary-foreground/75">
                  <p role="status">{status}</p>
                  {lastReply?.storyId === currentStory.id ? (
                    <button
                      type="button"
                      className="font-semibold underline underline-offset-2 disabled:opacity-50"
                      disabled={isReplying}
                      onClick={removeLastReply}
                    >
                      Undo reply
                    </button>
                  ) : null}
                </div>
              </footer>
            </article>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  )
}

function storyAuthor(story: CherishStory): string {
  if (story.isAnonymous) return "Anonymous"
  return story.submittedByName ?? "Team member"
}

function formatStoryAge(publishedAt: string): string {
  const elapsedMs = Math.max(0, Date.now() - new Date(publishedAt).getTime())
  const elapsedHours = Math.floor(elapsedMs / (60 * 60 * 1_000))
  if (elapsedHours === 0) return "Just now"
  return `${elapsedHours}h ago`
}
