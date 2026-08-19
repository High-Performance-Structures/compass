export const dynamic = "force-dynamic"

import type * as React from "react"
import { notFound } from "next/navigation"
import {
  IconDownload,
  IconExternalLink,
  IconFileDollar,
  IconLock,
} from "@tabler/icons-react"

import {
  getProjectBudgetSummary,
  type ProjectBudgetSummary,
} from "@/app/actions/project-budget"
import {
  getProjectAudiencePreview,
  type ProjectAudiencePreview as ProjectAudiencePreviewData,
} from "@/app/actions/project-audience-preview"
import {
  ProjectBudgetG703Table,
  ProjectBudgetPanel,
} from "@/components/projects/project-budget-panel"
import { ProjectBrandLogo } from "@/components/projects/project-brand-logo"
import { ProjectBudgetPrintButton } from "@/components/projects/project-budget-print-button"
import { ProjectAudiencePreviewShell } from "@/components/projects/project-audience-preview-shell"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { projectAudienceMessageShortcut } from "@/lib/project-audience-direct-message"
import { projectBrandFor } from "@/lib/project-branding"
import { budgetPaymentBreakdown } from "@/lib/project-budget-snapshot"

function hasDigest(error: unknown): error is { readonly digest: string } {
  return typeof error === "object" && error !== null && "digest" in error
}

function money(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value)
}

function formatDate(value: string | null): string {
  if (!value) return "Period not dated"
  return new Date(`${value}T00:00:00`).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  })
}

function statusLabel(value: string): string {
  return value
    .split("_")
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ")
}

function applicationDownloadHref(
  projectId: string,
  applicationId: string,
  download = false
): string {
  const href =
    `/api/projects/${encodeURIComponent(projectId)}` +
    `/pay-applications/${encodeURIComponent(applicationId)}/download`
  return download ? `${href}?download=1` : href
}

function centsDifference(left: number, right: number): number {
  return Math.round((left - right) * 100) / 100
}

export default async function OwnerBudgetPage({
  params,
}: {
  readonly params: Promise<{ readonly id: string }>
}): Promise<React.ReactElement> {
  const { id } = await params
  let preview: ProjectAudiencePreviewData
  let budget: ProjectBudgetSummary

  try {
    preview = await getProjectAudiencePreview(id, "owner")
    budget = await getProjectBudgetSummary(id, "owner")
  } catch (error) {
    if (hasDigest(error) && error.digest === "NEXT_NOT_FOUND") throw error
    notFound()
  }

  const brand = projectBrandFor({
    projectId: preview.project.id,
    projectNumber: preview.project.projectNumber,
  })
  const contractDifference = budget.currentApplication
    ? centsDifference(
        budget.totals.adjustedEstimate,
        budget.currentApplication.contractSumToDate
      )
    : 0
  const priorDifference = budget.currentApplication
    ? centsDifference(
        budget.totals.priorCosts,
        budget.currentApplication.previousCertificates
      )
    : 0
  const currentDifference = budget.currentApplication
    ? centsDifference(
        budget.totals.currentCosts,
        budget.currentApplication.currentPaymentDue
      )
    : 0
  const reconciliationRequired =
    Math.abs(contractDifference) >= 0.02 ||
    Math.abs(priorDifference) >= 0.02 ||
    Math.abs(currentDifference) >= 0.02
  const messageShortcut = projectAudienceMessageShortcut({
    projectId: preview.project.id,
    audience: preview.audience,
    viewerId: preview.viewer.id,
    contacts: preview.contacts,
    messageChannels: preview.messageChannels,
  })

  return (
    <ProjectAudiencePreviewShell
      audience="owner"
      projectId={preview.project.id}
      projectName={preview.project.name}
      projectNumber={preview.project.projectNumber}
      projectOptions={preview.projectOptions}
      viewer={preview.viewer}
      viewerIsInternal={preview.viewerIsInternal}
      messageShortcut={messageShortcut}
      activeSection="budget"
      warrantyEnabled={preview.project.warrantyEnabled}
    >
      <main className="min-h-screen bg-muted/20 px-4 py-5 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <div className="flex flex-wrap items-start justify-between gap-4 border-b pb-4">
            <div>
              <div className="flex items-center gap-2">
                <IconFileDollar className="size-5 text-primary" />
                <h1 className="text-2xl font-semibold tracking-tight">
                  Budget / G703
                </h1>
              </div>
              <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
                Your approved Schedule of Values and current payment progress.
              </p>
            </div>
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <IconLock className="size-4" />
              Approved owner financials
            </p>
          </div>

          {budget.applications.length > 0 && (
            <section className="mt-5 border bg-background p-4">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold">Pay applications</h2>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Review, print, or save every published application.
                  </p>
                </div>
                <Badge variant="outline">
                  {budget.applications.length} published
                </Badge>
              </div>
              <div className="mt-4 divide-y border">
                {budget.applications.map((application, index) => {
                  const payment = budgetPaymentBreakdown(application)

                  return (
                    <article
                      key={application.id}
                      className="grid gap-3 p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-medium">
                            Pay application {application.applicationNumber}
                          </p>
                          {index === 0 && <Badge>Current</Badge>}
                          <Badge variant="outline">
                            {statusLabel(application.status)}
                          </Badge>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Through {formatDate(application.periodTo)}
                          {" · "}
                          {money(payment.applicationTotal)} application total
                          {" · "}
                          {payment.depositApplied > 0
                            ? `${money(payment.currentPaymentDue)} due after ${money(payment.depositApplied)} deposit`
                            : `${money(payment.currentPaymentDue)} current payment`}
                          {" · "}
                          {money(application.contractSumToDate)} contract to date
                        </p>
                      </div>
                      {application.documentAvailable ? (
                        <div className="flex flex-wrap gap-2">
                          <Button asChild size="sm" variant="outline">
                            <a
                              href={applicationDownloadHref(
                                id,
                                application.id
                              )}
                              target="_blank"
                              rel="noreferrer"
                            >
                              <IconExternalLink className="size-4" />
                              Open PDF
                            </a>
                          </Button>
                          <Button asChild size="sm" variant="outline">
                            <a
                              href={applicationDownloadHref(
                                id,
                                application.id,
                                true
                              )}
                            >
                              <IconDownload className="size-4" />
                              Save
                            </a>
                          </Button>
                        </div>
                      ) : (
                        <Badge variant="secondary">Document unavailable</Badge>
                      )}
                    </article>
                  )
                })}
              </div>
            </section>
          )}

          {reconciliationRequired && (
            <div
              className="mt-5 border-l-4 border-l-amber-500 bg-amber-50 px-4 py-3 text-amber-950 print:hidden dark:bg-amber-950 dark:text-amber-50"
              role="status"
            >
              <p className="text-sm font-semibold">
                {preview.viewerIsInternal
                  ? "Sage reconciliation required"
                  : "Current detail is being reconciled"}
              </p>
              <p className="mt-1 text-xs leading-5">
                {preview.viewerIsInternal
                  ? "The certified pay-application header and imported G703 lines do not currently reconcile. Review the Sage progress-billing, deposit, retainage, and Schedule of Values data before publishing a regenerated package."
                  : "The detailed G703 is being checked against the certified pay application. The published application PDFs above remain available."}
              </p>
              {preview.viewerIsInternal && (
                <p className="mt-2 text-xs tabular-nums">
                  Contract difference: {money(contractDifference)}
                  {" · "}
                  Prior difference: {money(priorDifference)}
                  {" · "}
                  Current difference: {money(currentDifference)}
                </p>
              )}
            </div>
          )}

          <div
            className="mt-5"
            data-project-budget-print-source="true"
          >
            <header className="hidden border-b pb-3 print:flex print:items-start print:justify-between print:gap-4">
              <div className="flex items-center gap-3">
                <ProjectBrandLogo
                  brand={brand}
                  size={56}
                  className="size-14 object-contain"
                />
                <div>
                  <p className="text-lg font-semibold">{brand.companyName}</p>
                  <p className="text-sm text-muted-foreground">
                    {preview.project.projectNumber ?? preview.project.name}
                  </p>
                </div>
              </div>
              <div className="text-right text-xs">
                <p className="font-semibold">G703 Schedule of Values</p>
                <p className="mt-1 text-muted-foreground">
                  {budget.currentApplication
                    ? `Pay application ${budget.currentApplication.applicationNumber} · ` +
                      formatDate(budget.currentApplication.periodTo)
                    : "Current approved budget"}
                </p>
              </div>
            </header>

            <div className="print:hidden">
              <ProjectBudgetPanel
                projectId={id}
                summary={budget}
                detailHref={null}
                divisionLimit={null}
              />
            </div>

            {budget.allLines.length > 0 && (
              <section className="mt-6">
                <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-semibold">
                      G703 Schedule of Values
                    </h2>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Only lines approved for owner visibility are included.
                    </p>
                  </div>
                  <div className="print:hidden">
                    <ProjectBudgetPrintButton />
                  </div>
                </div>
                <ProjectBudgetG703Table
                  summary={budget}
                  showVisibility={false}
                />
              </section>
            )}
          </div>
        </div>
      </main>
    </ProjectAudiencePreviewShell>
  )
}
