const PROJECT_TITLE = "Compass Development & Feedback"

export const GITHUB_FEEDBACK_PROJECT_TITLE = PROJECT_TITLE

type FeedbackIssueIdentity = Readonly<{
  id: string
  kind: string
}>

export function feedbackReference(id: string): string {
  return `CFD-${id}`
}

/**
 * GitHub is an engineering work tracker, not a requester directory. This
 * intentionally contains no submitted title, message, source ID, or metadata.
 */
export function githubFeedbackIssueContent(
  item: FeedbackIssueIdentity,
): Readonly<{ title: string; body: string; labels: readonly string[] }> {
  const reference = feedbackReference(item.id)
  const kindLabel = githubLabel(item.kind)
  return {
    title: `[Compass feedback] ${item.kind} · ${reference}`,
    body: `## Compass feedback request\n\n- Kind: ${item.kind}\n- Private correlation: ${reference}\n\nThe requester identity, original channel, and full request content are retained only in Compass's protected Feedback Desk. Do not add requester names, email addresses, messaging identifiers, or other personal data to this issue.`,
    labels: kindLabel === "feedback" ? [kindLabel] : [kindLabel, "feedback"],
  }
}

function githubLabel(kind: string): string {
  switch (kind) {
    case "bug":
      return "bug"
    case "feature":
      return "enhancement"
    case "question":
      return "question"
    default:
      return "feedback"
  }
}
