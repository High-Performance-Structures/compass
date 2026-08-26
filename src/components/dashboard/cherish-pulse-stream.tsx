"use client"

import { useEffect, useState } from "react"
import {
  IconArchive,
  IconHeartHandshake,
  IconLock,
  IconSearch,
} from "@tabler/icons-react"

import {
  getCherishPulseLeadershipStream,
  getCherishPulseReviewQueue,
  getCherishPulseTeamStream,
  reviewCherishPulseResponse,
  searchCherishPulseArchive,
  type CherishPulseReviewItem,
} from "@/app/actions/cherish-pulse"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

function responseLabel(response: CherishPulseReviewItem): string {
  if (response.responseType === "concern") return "Private concern"
  if (response.responseType === "win") return "Project win"
  return "Team shoutout"
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  })
}

function submitterLabel(item: CherishPulseReviewItem): string {
  if (item.isAnonymous) return "Anonymous"
  return item.submittedByName ?? "Team member"
}

export function CherishPulseStream({
  canReview,
  refreshKey,
}: {
  readonly canReview: boolean
  readonly refreshKey: number
}): React.ReactElement {
  const [teamItems, setTeamItems] = useState<
    readonly CherishPulseReviewItem[]
  >([])
  const [reviewItems, setReviewItems] = useState<
    readonly CherishPulseReviewItem[]
  >([])
  const [privateItems, setPrivateItems] = useState<
    readonly CherishPulseReviewItem[]
  >([])
  const [archiveItems, setArchiveItems] = useState<
    readonly CherishPulseReviewItem[]
  >([])
  const [archiveQuery, setArchiveQuery] = useState("")
  const [archiveLoading, setArchiveLoading] = useState(false)
  const [archiveMessage, setArchiveMessage] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [reviewingId, setReviewingId] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true

    async function load(): Promise<void> {
      const teamResult = await getCherishPulseTeamStream()
      if (mounted && teamResult.success) setTeamItems(teamResult.data)

      if (canReview) {
        const [reviewResult, privateResult, archiveResult] = await Promise.all([
          getCherishPulseReviewQueue(),
          getCherishPulseLeadershipStream(),
          searchCherishPulseArchive(),
        ])
        if (mounted && reviewResult.success) setReviewItems(reviewResult.data)
        if (mounted && privateResult.success) setPrivateItems(privateResult.data)
        if (mounted && archiveResult.success) setArchiveItems(archiveResult.data)
      }

      if (mounted) setLoading(false)
    }

    void load()
    return () => {
      mounted = false
    }
  }, [canReview, refreshKey])

  async function searchArchive(): Promise<void> {
    setArchiveLoading(true)
    setArchiveMessage(null)
    const result = await searchCherishPulseArchive({ query: archiveQuery })
    if (result.success) {
      setArchiveItems(result.data)
      if (result.data.length === 0 && archiveQuery.trim().length > 0) {
        setArchiveMessage("No archived CHERISH feedback matched that search.")
      }
    } else {
      setArchiveMessage(result.error)
    }
    setArchiveLoading(false)
  }

  async function review(
    item: CherishPulseReviewItem,
    decision: "approve" | "archive"
  ): Promise<void> {
    setReviewingId(item.id)
    setMessage(null)
    const result = await reviewCherishPulseResponse({ id: item.id, decision })
    if (!result.success) {
      setMessage(result.error)
      setReviewingId(null)
      return
    }

    setReviewItems((current) => current.filter((entry) => entry.id !== item.id))
    if (decision === "archive") {
      setTeamItems((current) => current.filter((entry) => entry.id !== item.id))
      setPrivateItems((current) => current.filter((entry) => entry.id !== item.id))
      setMessage(
        item.reviewStatus === "approved" && item.visibility === "team"
          ? "Archived and removed from the team CHERISH stream."
          : "Archived from the CHERISH review queue.",
      )
      const archiveResult = await searchCherishPulseArchive({
        query: archiveQuery,
      })
      if (archiveResult.success) setArchiveItems(archiveResult.data)
    } else if (item.visibility === "team") {
      setTeamItems((current) => [
        { ...item, reviewStatus: "approved" },
        ...current.filter((entry) => entry.id !== item.id),
      ])
      setMessage("Approved and added to the team CHERISH stream.")
    } else if (decision === "approve") {
      setPrivateItems((current) => [
        { ...item, reviewStatus: "approved" },
        ...current.filter((entry) => entry.id !== item.id),
      ])
      setMessage("Acknowledged and retained in the leadership-only history.")
    }
    setReviewingId(null)
  }

  return (
    <div className="space-y-5">
      {canReview ? (
        <section className="border-y py-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Leadership review
              </p>
              <h4 className="mt-1 text-sm font-semibold">Waiting for review</h4>
            </div>
            <Badge variant="secondary">{reviewItems.length}</Badge>
          </div>

          <div className="mt-3 space-y-2">
            {!loading && reviewItems.length === 0 ? (
              <p className="border border-dashed p-3 text-xs text-muted-foreground">
                Nothing is waiting for review.
              </p>
            ) : null}
            {reviewItems.map((item) => (
              <article key={item.id} className="border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge
                    variant={item.visibility === "private" ? "secondary" : "outline"}
                  >
                    {responseLabel(item)}
                  </Badge>
                  <Badge variant="outline">{item.cherishValue}</Badge>
                  {item.visibility === "private" ? (
                    <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                      <IconLock className="size-3" /> Leadership only
                    </span>
                  ) : null}
                </div>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-5">
                  {item.message}
                </p>
                <p className="mt-2 text-[11px] text-muted-foreground">
                  {submitterLabel(item)} ·{" "}
                  {formatDate(item.createdAt)}
                </p>
                <div className="mt-3 flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => void review(item, "approve")}
                    disabled={reviewingId !== null}
                  >
                    {reviewingId === item.id
                      ? "Working…"
                      : item.visibility === "private"
                        ? "Acknowledge"
                        : "Approve"}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => void review(item, "archive")}
                    disabled={reviewingId !== null}
                  >
                    Archive
                  </Button>
                </div>
              </article>
            ))}
          </div>
          {message ? (
            <p className="mt-3 border-l-2 border-emerald-700 pl-2 text-xs text-muted-foreground">
              {message}
            </p>
          ) : null}

          {privateItems.length > 0 ? (
            <div className="mt-4">
              <p className="text-xs font-semibold text-muted-foreground">
                Reviewed private concerns
              </p>
              <div className="mt-2 space-y-2">
                {privateItems.map((item) => (
                  <article
                    key={item.id}
                    className="border border-[#9d832c] p-3"
                  >
                    <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                      <IconLock className="size-3" /> Leadership only ·{" "}
                      {formatDate(item.createdAt)}
                    </div>
                    <p className="mt-2 whitespace-pre-wrap text-sm leading-5">
                      {item.message}
                    </p>
                    <p className="mt-2 text-[11px] text-muted-foreground">
                      {submitterLabel(item)}
                    </p>
                  </article>
                ))}
              </div>
            </div>
          ) : null}

          <div className="mt-5 border-t pt-4">
            <div className="flex items-center gap-2">
              <IconArchive className="size-4 text-muted-foreground" />
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Archive
                </p>
                <h4 className="mt-1 text-sm font-semibold">
                  Search past CHERISH feedback
                </h4>
              </div>
            </div>
            <form
              className="mt-3 flex flex-col gap-2 sm:flex-row"
              onSubmit={(event) => {
                event.preventDefault()
                void searchArchive()
              }}
            >
              <Input
                value={archiveQuery}
                onChange={(event) => setArchiveQuery(event.target.value)}
                maxLength={100}
                placeholder="Search message, value, type, or submitter"
                aria-label="Search archived CHERISH feedback"
              />
              <Button type="submit" variant="outline" disabled={archiveLoading}>
                <IconSearch className="size-4" />
                {archiveLoading ? "Searching…" : "Search"}
              </Button>
            </form>
            {archiveMessage ? (
              <p className="mt-2 text-xs text-muted-foreground" role="status">
                {archiveMessage}
              </p>
            ) : null}
            <div className="mt-3 space-y-2">
              {archiveItems.map((item) => (
                <article key={item.id} className="border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">{item.cherishValue}</Badge>
                    <span className="text-[11px] text-muted-foreground">
                      {responseLabel(item)} · {formatDate(item.createdAt)}
                    </span>
                    {item.visibility === "private" ? (
                      <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                        <IconLock className="size-3" /> Leadership only
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-5">
                    {item.message}
                  </p>
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    {submitterLabel(item)}
                  </p>
                </article>
              ))}
              {!loading && archiveItems.length === 0 && !archiveMessage ? (
                <p className="border border-dashed p-3 text-xs text-muted-foreground">
                  No CHERISH feedback has been archived yet.
                </p>
              ) : null}
            </div>
          </div>
        </section>
      ) : null}

      <section>
        <div className="flex items-center gap-2">
          <IconHeartHandshake className="size-4 text-[#9d832c]" />
          <h4 className="text-sm font-semibold">Team recognition</h4>
        </div>
        <div className="mt-3 space-y-2">
          {!loading && teamItems.length === 0 ? (
            <p className="border border-dashed p-3 text-xs text-muted-foreground">
              Approved CHERISH recognition will appear here.
            </p>
          ) : null}
          {teamItems.map((item) => (
            <article
              key={item.id}
              className="border-l-4 border-emerald-700 bg-muted/20 p-3"
            >
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">{item.cherishValue}</Badge>
                <span className="text-[11px] text-muted-foreground">
                  {responseLabel(item)} · {formatDate(item.createdAt)}
                </span>
              </div>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-5">
                {item.message}
              </p>
              <p className="mt-2 text-[11px] text-muted-foreground">
                {item.isAnonymous
                  ? "Shared anonymously"
                  : `Shared by ${item.submittedByName ?? "a team member"}`}
              </p>
              {canReview ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="mt-3"
                  onClick={() => void review(item, "archive")}
                  disabled={reviewingId !== null}
                >
                  {reviewingId === item.id
                    ? "Archiving…"
                    : "Archive from team stream"}
                </Button>
              ) : null}
            </article>
          ))}
        </div>
      </section>
    </div>
  )
}
