import type { FieldDocument } from "@/lib/field/types"

export const REVIEW_SAMPLE_PROJECT_ID = "proj-bt-sample-job"

export function isReviewSampleProject(projectId: string): boolean {
  return projectId === REVIEW_SAMPLE_PROJECT_ID
}

type ReviewSampleFile = {
  readonly document: FieldDocument
  readonly content: string
}

const REVIEW_SAMPLE_FILES: readonly ReviewSampleFile[] = [
  {
    document: {
      id: "review-sample-safety-checklist",
      name: "Site Safety Checklist.txt",
      type: "file",
      mimeType: "text/plain",
      modifiedAt: "2026-08-29T14:00:00.000Z",
      webViewLink: null,
    },
    content: `SITE SAFETY CHECKLIST

Project: TEST-001 - Compass Review Sample Project

[ ] Confirm emergency contacts are posted
[ ] Walk the delivery and evacuation routes
[ ] Inspect tools and equipment before use
[ ] Verify required personal protective equipment
[ ] Photograph the entrance, staging area, and active work zone
[ ] Review today's work plan with the field team

This document contains fictional sample data for app review.
`,
  },
  {
    document: {
      id: "review-sample-first-week-plan",
      name: "First Week Field Plan.txt",
      type: "file",
      mimeType: "text/plain",
      modifiedAt: "2026-08-29T14:05:00.000Z",
      webViewLink: null,
    },
    content: `FIRST WEEK FIELD PLAN

Project: TEST-001 - Compass Review Sample Project

1. Complete site layout and safety setup.
2. Verify underground utility markings.
3. Prepare for the foundation inspection.
4. Confirm the first material delivery route and staging area.

Field notes:
- Keep the project message thread current with questions and blockers.
- Save these reference files offline before leaving network coverage.
- Add a daily log and site-condition photos at the end of each shift.

This document contains fictional sample data for app review.
`,
  },
]

export function reviewSampleDocuments(
  projectId: string
): readonly FieldDocument[] {
  return isReviewSampleProject(projectId)
    ? REVIEW_SAMPLE_FILES.map((file) => file.document)
    : []
}

export function reviewSampleFile(
  projectId: string | null,
  fileId: string
): ReviewSampleFile | null {
  if (!projectId || !isReviewSampleProject(projectId)) return null
  return REVIEW_SAMPLE_FILES.find((file) => file.document.id === fileId) ?? null
}
