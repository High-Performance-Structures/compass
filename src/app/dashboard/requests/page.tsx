import {
  IconMessageCircleQuestion,
} from "@tabler/icons-react"

import { getMyFeedbackRequests } from "@/app/actions/feedback-requests"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { feedbackStatusLabel } from "@/lib/jarvis/feedback-lifecycle"

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value))
}

export default async function RequestsPage() {
  const result = await getMyFeedbackRequests()
  const requests = result.success ? result.data : []

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-4 md:p-6">
      <div>
        <p className="text-sm font-medium text-primary">
          Compass Feedback Desk
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">
          My requests
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Follow feature requests and problem reports from receipt
          through deployment.
        </p>
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
                Requests submitted through Ask Jarvis or Compass
                Feedback will appear here.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4">
        {requests.map((request) => (
          <Card key={request.id} id={`request-${request.id}`}>
            <CardHeader className="gap-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <CardTitle className="text-base">
                    {request.title}
                  </CardTitle>
                  <CardDescription className="mt-1">
                    Submitted {formatDate(request.createdAt)}
                  </CardDescription>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Badge variant="secondary">
                    {feedbackStatusLabel(request.status)}
                  </Badge>
                  <Badge variant="outline">{request.kind}</Badge>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                {request.description}
              </p>
              <p className="text-xs text-muted-foreground">
                Last updated {formatDate(request.updatedAt)}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
