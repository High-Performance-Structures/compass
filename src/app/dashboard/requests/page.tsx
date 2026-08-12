import Link from "next/link"

import { getMyFeedbackRequests } from "@/app/actions/feedback-requests"
import { MyRequestsList } from "@/app/dashboard/requests/my-requests-list"
import { RequestRefreshControl } from "@/app/dashboard/requests/request-refresh-control"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

export const dynamic = "force-dynamic"

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
          <p className="text-sm font-medium text-primary">Compass Feedback Desk</p>
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

      {result.success && (
        <MyRequestsList requests={requests} showingAll={showingAll} />
      )}
    </div>
  )
}
