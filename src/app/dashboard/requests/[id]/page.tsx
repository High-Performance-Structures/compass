import Link from "next/link"
import { notFound } from "next/navigation"
import {
  IconArrowLeft,
  IconBrandGithub,
  IconCircleCheck,
  IconClock,
  IconExternalLink,
} from "@tabler/icons-react"

import { getMyFeedbackRequest } from "@/app/actions/feedback-requests"
import { RequestRefreshControl } from "@/app/dashboard/requests/request-refresh-control"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { feedbackStatusLabel } from "@/lib/jarvis/feedback-lifecycle"

export const dynamic = "force-dynamic"

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value))
}

export default async function RequestDetailPage({
  params,
}: {
  readonly params: Promise<{ readonly id: string }>
}) {
  const { id } = await params
  const result = await getMyFeedbackRequest(id)
  if (!result.success) notFound()
  const request = result.data

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/dashboard/requests">
            <IconArrowLeft className="size-4" />
            All requests
          </Link>
        </Button>
        <RequestRefreshControl />
      </div>

      <div>
        <div className="mb-3 flex flex-wrap gap-2">
          <Badge variant="secondary">
            {feedbackStatusLabel(request.status)}
          </Badge>
          <Badge variant="outline">{request.kind}</Badge>
          {request.priority !== "normal" && (
            <Badge variant="outline">{request.priority} priority</Badge>
          )}
        </div>
        <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">
          {request.title}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Submitted {formatDate(request.createdAt)} · Last updated {formatDate(request.updatedAt)}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Original request</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="whitespace-pre-wrap text-sm leading-6">
            {request.description}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between gap-4">
          <CardTitle className="text-base">Progress</CardTitle>
          <span className="text-xs text-muted-foreground">Live record</span>
        </CardHeader>
        <CardContent>
          <ol className="space-y-0">
            {request.timeline.map((entry, index) => {
              const isLatest = index === request.timeline.length - 1
              return (
                <li key={entry.id} className="relative flex gap-4 pb-7 last:pb-0">
                  {index < request.timeline.length - 1 && (
                    <span className="absolute left-[9px] top-5 h-[calc(100%-0.25rem)] w-px bg-border" />
                  )}
                  {isLatest ? (
                    <IconCircleCheck className="relative z-10 mt-0.5 size-5 shrink-0 bg-background text-primary" />
                  ) : (
                    <IconClock className="relative z-10 mt-0.5 size-5 shrink-0 bg-background text-muted-foreground" />
                  )}
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                      <p className="font-medium">{entry.label}</p>
                      <time className="text-xs text-muted-foreground">
                        {formatDate(entry.occurredAt)}
                      </time>
                    </div>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">
                      {entry.message}
                    </p>
                  </div>
                </li>
              )
            })}
          </ol>
        </CardContent>
      </Card>

      {(request.githubIssueUrl || request.githubDraftPullRequestUrl) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Implementation record</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-3">
            {request.githubIssueUrl && (
              <Button variant="outline" size="sm" asChild>
                <a href={request.githubIssueUrl} target="_blank" rel="noreferrer">
                  <IconBrandGithub className="size-4" />
                  GitHub issue
                  <IconExternalLink className="size-3" />
                </a>
              </Button>
            )}
            {request.githubDraftPullRequestUrl && (
              <Button variant="outline" size="sm" asChild>
                <a href={request.githubDraftPullRequestUrl} target="_blank" rel="noreferrer">
                  <IconBrandGithub className="size-4" />
                  Implementation PR
                  <IconExternalLink className="size-3" />
                </a>
              </Button>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
