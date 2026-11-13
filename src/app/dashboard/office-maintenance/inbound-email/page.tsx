import { redirect } from "next/navigation"

/**
 * Retired: held job emails and inbound texts are reviewed on the Staff
 * Message Desk now. Old links and bookmarks land on its held emails.
 */
export default function InboundEmailReviewPage(): never {
  redirect("/dashboard/office-maintenance/message-desk?section=held-emails#held-job-emails")
}
