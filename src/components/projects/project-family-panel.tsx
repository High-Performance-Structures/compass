import Link from "next/link"

import type { ProjectFamilySummary } from "@/app/actions/project-families"
import { Badge } from "@/components/ui/badge"
import {
  ProjectFamilyPhaseDriveRetryButton,
  ProjectFamilyPhaseCreateForm,
  ProjectFamilySetupPrompt,
} from "@/components/projects/project-family-setup"

function amountLabel(cents: number | null): string | null {
  if (cents === null) return null
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(cents / 100)
}

function driveUrl(folderId: string): string {
  return `https://drive.google.com/drive/folders/${folderId}`
}

export function ProjectFamilyPanel({
  summary,
  canManage,
  projectId,
  projectName,
}: {
  readonly summary: ProjectFamilySummary | null
  readonly canManage: boolean
  readonly projectId: string
  readonly projectName: string
}): React.ReactElement | null {
  if (!summary) {
    return canManage ? (
      <ProjectFamilySetupPrompt
        projectId={projectId}
        projectName={projectName}
      />
    ) : null
  }

  const nextSequence = summary.phases.reduce(
    (highest, phase) => Math.max(highest, phase.sequence),
    0,
  ) + 1

  return (
    <section className="mb-4 rounded-lg border p-3 sm:mb-5 sm:p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase text-muted-foreground">
            Project family
          </p>
          <h2 className="mt-1 text-base font-semibold">{summary.family.name}</h2>
          {summary.family.description && (
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              {summary.family.description}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline">{summary.family.status}</Badge>
          {summary.family.googleDriveFolderId && (
            <a
              href={driveUrl(summary.family.googleDriveFolderId)}
              target="_blank"
              rel="noreferrer"
              className="text-sm text-primary hover:underline"
            >
              Open family Drive folder
            </a>
          )}
        </div>
      </div>

      <div className="mt-4 divide-y border-y">
        {summary.phases.map((phase) => {
          const authorizedAmount = amountLabel(
            phase.authorizedContractAmountCents,
          )
          const isCurrent = phase.id === summary.currentPhaseId

          return (
            <div
              key={phase.id}
              className="flex flex-wrap items-start justify-between gap-3 py-3"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-medium uppercase text-muted-foreground">
                    Phase {phase.sequence}
                  </span>
                  <span className="font-medium">{phase.name}</span>
                  {isCurrent && <Badge variant="secondary">Current</Badge>}
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {phase.jobStatusLabel}
                  {phase.projectNumber && <> · {phase.projectNumber}</>}
                  {authorizedAmount && <> · {authorizedAmount} authorized</>}
                </p>
                {phase.description && (
                  <p className="mt-1 text-sm text-muted-foreground">
                    {phase.description}
                  </p>
                )}
                {phase.originatingChangeOrder && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Governed by {phase.originatingChangeOrder.number} · {" "}
                    {phase.originatingChangeOrder.status}
                  </p>
                )}
              </div>

              {phase.projectId ? (
                <Link
                  href={`/dashboard/projects/${phase.projectId}`}
                  className="shrink-0 text-sm text-primary hover:underline"
                >
                  Open phase project
                </Link>
              ) : phase.googleDriveFolderId ? (
                <a
                  href={driveUrl(phase.googleDriveFolderId)}
                  target="_blank"
                  rel="noreferrer"
                  className="shrink-0 text-sm text-primary hover:underline"
                >
                  Open phase Drive folder
                </a>
              ) : canManage ? (
                <ProjectFamilyPhaseDriveRetryButton phaseId={phase.id} />
              ) : (
                <span className="shrink-0 text-sm text-muted-foreground">
                  Phase folder pending
                </span>
              )}
            </div>
          )
        })}
      </div>
      {canManage && (
        <ProjectFamilyPhaseCreateForm
          familyId={summary.family.id}
          nextSequence={nextSequence}
        />
      )}
    </section>
  )
}
