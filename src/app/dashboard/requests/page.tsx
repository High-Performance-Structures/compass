import Link from "next/link"
import {
  IconArrowRight,
  IconMessageCircleQuestion,
} from "@tabler/icons-react"

import { getMyFeedbackRequests } from "@/app/actions/feedback-requests"
import { RequestRefreshControl } from "@/app/dashboard/requests/request-refresh-control"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { feedbackStatusLabel } from "@/lib/jarvis/feedback-lifecycle"

export const dynamic = "force-dynamic"

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value))
}

export default async function RequestsPage({
  searchParams,
}: Readonly<{
  searchParams: Promise<{ readonly scope?: string }>
}>) {
  const params = await searchParams
  const scope = params.scope === "all" ? "all" : "mine"
  const result = await getMyFeedbackRequests(scope)
  const requests = result.success ? result.data : []
  const showingAll = result.success && result.scope === "all"

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-4 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-primary">
            Compass Feedback Desk
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">
            {showingAll ? "All requests" : "My requests"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Follow each request from receipt through implementation.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant={!showingAll ? "secondary" : "ghost"} size="sm" asChild>
            <Link href="/dashboard/requests">My requests</Link>
          </Button>
          {result.success && result.canViewAll && (
            <Button variant={showingAll ? "secondary" : "ghost"} size="sm" asChild>
              <Link href="/dashboard/requests?scope=all">All requests</Link>
            </Button>
          )}
          <RequestRefreshControl scope={scope} />
        </div>
      </div>

      {!result.success && (
        <Card>
          <CardHeader>
            <CardTitle>Requests are temporarily unavailable</CardTitle>
            <CardDescription>{result.error}</CardDescription>
          </CardHeader>
        </Card>
      )}

      {result.success && requests.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <IconMessageCircleQuestion className="size-8 text-muted-foreground" />
            <div>
              <p className="font-medium">No requests yet</p>
              <p className="text-sm text-muted-foreground">
                Requests submitted through Ask Jarvis or Compass Feedback
                will appear here.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-3">
        {requests.map((request) => (
          <Link
            key={request.id}
            href={`/dashboard/requests/${encodeURIComponent(request.id)}${showingAll ? "?scope=all" : ""}`}
            className="group rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Card className="transition-colors group-hover:border-primary/45 group-hover:bg-muted/20">
              <CardHeader className="gap-3">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <CardTitle className="text-base">
                      {request.title}
                    </CardTitle>
                    <CardDescription className="mt-1">
                      {showingAll && request.reporterName
                        ? `${request.reporterName} · `
                        : ""}
                      Submitted {formatDate(request.createdAt)}
                    </CardDescription>
                  </div>
                  <IconArrowRight className="mt-1 size-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="line-clamp-2 whitespace-pre-wrap text-sm text-muted-foreground">
                  {request.description}
                </p>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="secondary">
                      {feedbackStatusLabel(request.status)}
                    </Badge>
                    <Badge variant="outline">{request.kind}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {request.assignedToName ?? "Awaiting assignment"} · Updated {formatDate(request.updatedAt)}
                  </p>
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  )
}
