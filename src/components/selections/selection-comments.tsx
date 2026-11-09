"use client"

/*
 * A selection's comments. Staff can mark a comment staff-only; owners only
 * ever see and write owner-visible comments. An owner's comment gives staff
 * an "Answer owner question" to-do on the server side.
 */
import * as React from "react"
import { IconTrash } from "@tabler/icons-react"

import { addSelectionComment, deleteSelectionComment } from "@/app/actions/selection-choices"
import { SourceTag } from "@/components/shared/source-tag"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Textarea } from "@/components/ui/textarea"
import type { SelectionCommentView } from "@/lib/domain/selections/choices-read"
import { formatDate } from "@/lib/format"
import { cn } from "@/lib/utils"

export function SelectionComments({
  projectId,
  selectionId,
  audience,
  comments,
  onChanged,
  placeholder = "Add a comment…",
}: {
  readonly projectId: string
  readonly selectionId: string
  readonly audience: "staff" | "owner"
  readonly comments: readonly SelectionCommentView[]
  readonly onChanged: () => void
  readonly placeholder?: string
}): React.ReactElement {
  const [body, setBody] = React.useState("")
  const [staffOnly, setStaffOnly] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [pending, startTransition] = React.useTransition()
  const inputId = React.useId()

  function post(event: React.FormEvent): void {
    event.preventDefault()
    setError(null)
    startTransition(async () => {
      const result = await addSelectionComment(projectId, selectionId, body, staffOnly ? "staff" : "owner", audience)
      if (!result.success) {
        setError(result.error)
        return
      }
      setBody("")
      onChanged()
    })
  }

  function remove(commentId: string): void {
    if (!window.confirm("Delete this comment?")) return
    startTransition(async () => {
      const result = await deleteSelectionComment(projectId, selectionId, commentId, audience)
      if (!result.success) setError(result.error)
      else onChanged()
    })
  }

  return (
    <div className="flex flex-col gap-2">
      {comments.length === 0 ? (
        <p className="text-sm text-muted-foreground">No comments yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {comments.map((comment) => (
            <li
              key={comment.id}
              className={cn("flex flex-col gap-0.5 rounded-md px-2 py-1.5 text-sm", comment.visibility === "staff" && "bg-muted")}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate">
                  <span className="font-medium">{comment.authorName}</span>
                  <span className="text-muted-foreground"> · {formatDate(comment.createdAt)}</span>
                  {audience === "staff" && (
                    <span className="text-muted-foreground"> · {comment.visibility === "staff" ? "staff only" : "owner-visible"}</span>
                  )}
                  {comment.sourceSystem === "buildertrend" && <SourceTag source="buildertrend" className="ml-1" />}
                </span>
                {comment.canDelete && (
                  <Button type="button" variant="ghost" size="icon" className="size-7" aria-label="Delete comment" disabled={pending} onClick={() => remove(comment.id)}>
                    <IconTrash className="size-3.5" />
                  </Button>
                )}
              </div>
              <p className="whitespace-pre-wrap break-words">{comment.body}</p>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={post} className="flex flex-col gap-2">
        <label htmlFor={inputId} className="sr-only">Add a comment</label>
        <Textarea id={inputId} value={body} onChange={(event) => setBody(event.target.value)} placeholder={placeholder} rows={2} maxLength={4000} />
        <div className="flex flex-wrap items-center justify-between gap-2">
          {audience === "staff" ? (
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <Checkbox checked={staffOnly} onCheckedChange={(value) => setStaffOnly(value === true)} />
              Staff only
            </label>
          ) : (
            <span className="text-xs text-muted-foreground">Your builder will reply here.</span>
          )}
          <Button type="submit" size="sm" disabled={pending || !body.trim()}>
            Post
          </Button>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </form>
    </div>
  )
}
