import { getFeedbackAdminOverview } from "@/app/actions/feedback-admin"
import { FeedbackDeskAdmin } from "@/components/feedback/feedback-desk-admin"
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

export const dynamic = "force-dynamic"

export default async function FeedbackDeskManagePage({
  searchParams,
}: Readonly<{ searchParams: Promise<Readonly<Record<string, string | string[] | undefined>>> }>) {
  const { request } = await searchParams
  const result = await getFeedbackAdminOverview()
  if (!result.success) {
    return (
      <div className="mx-auto w-full max-w-7xl p-4 md:p-6">
        <Card>
          <CardHeader>
            <CardTitle>Feedback Desk unavailable</CardTitle>
            <CardDescription>{result.error}</CardDescription>
          </CardHeader>
        </Card>
      </div>
    )
  }
  return (
    <FeedbackDeskAdmin
      overview={result.data}
      requestId={typeof request === "string" ? request : null}
    />
  )
}
