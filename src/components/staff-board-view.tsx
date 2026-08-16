"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import {
  IconBellRinging,
  IconPin,
  IconPinFilled,
  IconSend,
  IconTrash,
} from "@tabler/icons-react"

import {
  createStaffBoardPost,
  deleteStaffBoardPost,
  toggleStaffBoardPostPin,
  type StaffBoardPost,
} from "@/app/actions/staff-board"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"

function authorName(post: StaffBoardPost): string {
  return post.author.displayName ?? post.author.email
}

function postDate(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
}

export function StaffBoardView({
  initialPosts,
  currentUserId,
  canModerate,
}: {
  readonly initialPosts: readonly StaffBoardPost[]
  readonly currentUserId: string
  readonly canModerate: boolean
}) {
  const router = useRouter()
  const [title, setTitle] = useState("")
  const [body, setBody] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [busyPostId, setBusyPostId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function submitPost(): Promise<void> {
    setSubmitting(true)
    setError(null)
    const result = await createStaffBoardPost({ title, body })
    if (!result.success) {
      setError(result.error)
      setSubmitting(false)
      return
    }
    setTitle("")
    setBody("")
    setSubmitting(false)
    router.refresh()
  }

  async function removePost(postId: string): Promise<void> {
    if (!window.confirm("Remove this Staff Board post?")) return
    setBusyPostId(postId)
    setError(null)
    const result = await deleteStaffBoardPost(postId)
    if (!result.success) setError(result.error)
    setBusyPostId(null)
    if (result.success) router.refresh()
  }

  async function togglePin(postId: string): Promise<void> {
    setBusyPostId(postId)
    setError(null)
    const result = await toggleStaffBoardPostPin(postId)
    if (!result.success) setError(result.error)
    setBusyPostId(null)
    if (result.success) router.refresh()
  }

  return (
    <div className="mx-auto flex h-full w-full max-w-5xl flex-col gap-6 overflow-y-auto p-4 md:p-8">
      <header className="flex flex-col gap-2 border-b pb-5">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-primary/10 p-2 text-primary">
            <IconBellRinging className="size-6" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Staff Board</h1>
            <p className="text-sm text-muted-foreground">
              One place for company-wide updates, reminders, and notices for Compass staff.
            </p>
          </div>
        </div>
      </header>

      <Card>
        <CardHeader className="gap-1">
          <CardTitle className="text-base">Post an update</CardTitle>
          <p className="text-sm text-muted-foreground">
            Every active internal staff member can see new posts. A quiet in-app notification is sent to the team.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Short update title"
            maxLength={120}
            aria-label="Staff Board post title"
          />
          <Textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            placeholder="Write the update for the team..."
            maxLength={5000}
            rows={4}
            aria-label="Staff Board post message"
          />
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              Keep project-specific discussion in Conversations.
            </p>
            <Button type="button" onClick={() => void submitPost()} disabled={submitting}>
              <IconSend className="size-4" />
              {submitting ? "Posting..." : "Post update"}
            </Button>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </CardContent>
      </Card>

      <section className="space-y-4" aria-labelledby="staff-board-posts-heading">
        <div className="flex items-center justify-between gap-3">
          <h2 id="staff-board-posts-heading" className="text-lg font-semibold">
            Team updates
          </h2>
          <span className="text-sm text-muted-foreground">
            {initialPosts.length} {initialPosts.length === 1 ? "post" : "posts"}
          </span>
        </div>
        {initialPosts.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-sm text-muted-foreground">
              No updates yet. The first post will appear here for the whole staff team.
            </CardContent>
          </Card>
        ) : (
          initialPosts.map((post) => (
            <Card key={post.id} className={post.isPinned ? "border-primary/40" : undefined}>
              <CardHeader className="gap-2">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <CardTitle className="flex items-center gap-2 text-base">
                      {post.isPinned && <IconPinFilled className="size-4 text-primary" />}
                      <span className="truncate">{post.title}</span>
                    </CardTitle>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {authorName(post)} · {postDate(post.createdAt)}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {canModerate && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={post.isPinned ? "Unpin post" : "Pin post"}
                        disabled={busyPostId === post.id}
                        onClick={() => void togglePin(post.id)}
                      >
                        <IconPin className="size-4" />
                      </Button>
                    )}
                    {(canModerate || post.author.id === currentUserId) && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label="Remove post"
                        disabled={busyPostId === post.id}
                        onClick={() => void removePost(post.id)}
                      >
                        <IconTrash className="size-4" />
                      </Button>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <p className="whitespace-pre-wrap text-sm leading-6">{post.body}</p>
              </CardContent>
            </Card>
          ))
        )}
      </section>
    </div>
  )
}
