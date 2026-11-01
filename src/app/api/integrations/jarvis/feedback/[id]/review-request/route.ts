import { handleFeedbackReviewRequest } from "@/lib/jarvis/feedback-review-request"

export async function POST(
  request: Request,
  { params }: { readonly params: Promise<{ readonly id: string }> },
): Promise<Response> {
  const { id } = await params
  return handleFeedbackReviewRequest(request, id)
}
