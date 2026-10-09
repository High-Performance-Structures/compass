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
import { PageHeader } from "@/components/page-header"

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
      <PageHeader
        className="mb-0"
        eyebrow="Compass Feedback Desk"
        title={showingAll ? "All requests" : "My requests"}
        actions={
          <>
            <Button variant={!showingAll ? "secondary" : "ghost"} size="sm" asChild>
              <Link href="/dashboard/requests">My requests</Link>
            </Button>
            {result.success && result.canViewAll && (
              <Button variant={showingAll ? "secondary" : "ghost"} size="sm" asChild>
                <Link href="/dashboard/requests?scope=all">All requests</Link>
              </Button>
            )}
            <RequestRefreshControl scope={scope} />
          </>
        }
      />

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
