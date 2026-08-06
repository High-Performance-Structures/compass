"use client"

import * as React from "react"
import { IconMailCheck, IconLoader2 } from "@tabler/icons-react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"

type SyncSummary = {
  readonly scanned?: number
  readonly posted?: number
  readonly needsReview?: number
  readonly errors?: readonly string[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function syncSummaries(value: unknown): readonly SyncSummary[] {
  if (!isRecord(value) || !Array.isArray(value.summaries)) return []
  return value.summaries.filter(isRecord)
}

export function ProjectRfiEmailSyncButton(): React.ReactElement {
  const router = useRouter()
  const [syncing, setSyncing] = React.useState(false)

  async function syncReplies(): Promise<void> {
    setSyncing(true)
    try {
      const response = await fetch("/api/email/gmail-sync", { method: "POST" })
      const payload: unknown = await response.json()
      if (!response.ok || !isRecord(payload) || payload.success !== true) {
        const error = isRecord(payload) && typeof payload.error === "string"
          ? payload.error
          : "Unable to check email replies."
        toast.error(error)
        return
      }

      const summaries = syncSummaries(payload)
      const errors = summaries.flatMap((summary) => summary.errors ?? [])
      const posted = summaries.reduce((total, summary) => total + (summary.posted ?? 0), 0)
      const needsReview = summaries.reduce(
        (total, summary) => total + (summary.needsReview ?? 0),
        0
      )
      if (errors.length > 0) {
        toast.error(errors[0])
      } else if (posted > 0) {
        toast.success(`${posted} email ${posted === 1 ? "reply" : "replies"} added to Compass.`)
      } else if (needsReview > 0) {
        toast.warning(`${needsReview} email ${needsReview === 1 ? "needs" : "need"} staff review.`)
      } else {
        toast.info("No new tracked email replies were found.")
      }
      router.refresh()
    } catch {
      toast.error("Unable to check email replies.")
    } finally {
      setSyncing(false)
    }
  }

  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      disabled={syncing}
      onClick={() => void syncReplies()}
    >
      {syncing ? (
        <IconLoader2 className="size-4 animate-spin" />
      ) : (
        <IconMailCheck className="size-4" />
      )}
      Check email replies
    </Button>
  )
}
