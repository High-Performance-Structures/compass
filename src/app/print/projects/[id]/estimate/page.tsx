export const dynamic = "force-dynamic"

import { requireProjectRouteId } from "@/lib/project-route-id"
import { redirect } from "next/navigation"

import { getProjectEstimateWorkspace } from "@/app/actions/project-estimates"
import { ProjectBrandContactDetails } from "@/components/projects/project-brand-contact-details"
import { ProjectBrandLogo } from "@/components/projects/project-brand-logo"
import { ProjectEstimateReportActions } from "@/components/projects/project-estimate-report-actions"
import { ProjectEstimateReportPhases } from "@/components/projects/project-estimate-report-phases"
import {
  clientEstimateBuilderFeeExclusionSummary,
  clientEstimatePhases,
  clientEstimateTaxSummary,
} from "@/lib/estimates/client-report"
import { acceptedEstimateDocumentUrl } from "@/lib/estimates/accepted-document"
import { projectBrandFor, projectLegalEntityName } from "@/lib/project-branding"

function money(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(cents / 100)
}

function percent(basisPoints: number): string {
  return `${(basisPoints / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  })}%`
}

function estimateDate(value: string | null, createdAt: string): string {
  const dateValue = value ?? createdAt.slice(0, 10)
  const date = new Date(`${dateValue}T12:00:00`)
  if (Number.isNaN(date.valueOf())) return dateValue
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(date)
}

export default async function ProjectEstimatePrintPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ id: string }>
  readonly searchParams: Promise<{ estimateId?: string }>
}): Promise<React.ReactElement> {
  const [{ id: rawProjectId }, query] = await Promise.all([params, searchParams])
  const id = await requireProjectRouteId(rawProjectId)
  const workspace = await getProjectEstimateWorkspace(id, query.estimateId)
  const estimate = workspace.activeEstimate
  const brand = projectBrandFor({
    projectId: id,
    projectNumber: workspace.projectNumber,
  })
  const legalEntityName = projectLegalEntityName(brand.department)

  if (!estimate) {
    return <main className="p-8">Estimate not found.</main>
  }
  const acceptedDocumentUrl = acceptedEstimateDocumentUrl(estimate)
  if (acceptedDocumentUrl) redirect(acceptedDocumentUrl)

  const phaseDescriptions = Object.fromEntries(
    workspace.phaseDescriptions.map((item) => [
      item.divisionCode,
      item.description,
    ])
  )
  const phases = clientEstimatePhases({
    lines: workspace.lines,
    phaseDescriptions,
    reportPhases: workspace.reportPhases,
    defaultItemize: workspace.reportMode === "line_items",
  })
  const clientSubtotalCents = phases.reduce(
    (total, phase) => total + phase.subtotalCents,
    0
  )
  const taxSummary = clientEstimateTaxSummary(
    phases.flatMap((phase) => phase.lines)
  )
  const clientPreTaxSubtotalCents = clientSubtotalCents - taxSummary.taxCents
  const clientTotalCents = clientSubtotalCents + estimate.builderFeeCents
  const builderFeeRateBasisPoints =
    estimate.overheadRateBasisPoints +
    estimate.marginRateBasisPoints +
    estimate.contingencyRateBasisPoints
  const builderFeeExclusions = clientEstimateBuilderFeeExclusionSummary(
    phases.flatMap((phase) => phase.lines)
  )
  return (
    <>
      <style>{`
        @page { size: letter; margin: 0.55in; }
        @media print {
          body { background: white !important; }
          .estimate-report-actions { display: none !important; }
          .estimate-report { margin: 0 !important; max-width: none !important; padding: 0 !important; }
          .estimate-acknowledgement { break-before: page; }
          .estimate-signature-page { break-before: page; }
        }
      `}</style>
      <ProjectEstimateReportActions
        title={estimate.title}
        estimateNumber={estimate.estimateNumber}
        projectId={id}
        estimateId={estimate.id}
      />
      <main className="estimate-report mx-auto max-w-[8.5in] bg-white p-8 text-black print:max-w-none print:p-0">
        <header className="flex items-start justify-between gap-6 border-b-2 border-black pb-5">
          <div className="flex items-center gap-4">
            <ProjectBrandLogo
              brand={brand}
              size={80}
              className="size-20 object-contain"
            />
            <div>
              <p className="text-lg font-bold">{brand.companyName}</p>
              <ProjectBrandContactDetails
                brand={brand}
                lineClassName="text-sm"
              />
            </div>
          </div>
          <div className="text-right">
            <h1 className="text-xl font-bold">{estimate.title}</h1>
            <p className="mt-1 text-sm">{estimate.estimateNumber}</p>
            <p className="text-sm">Version {estimate.versionNumber}</p>
          </div>
        </header>

        <section className="mt-5 grid grid-cols-2 gap-6 text-sm">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide">
              Project
            </p>
            <p className="mt-1 font-semibold">{workspace.projectName}</p>
            {workspace.projectAddress && (
              <p className="whitespace-pre-line">{workspace.projectAddress}</p>
            )}
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide">
              Prepared for
            </p>
            <p className="mt-1 font-semibold">
              {estimate.clientName ?? "Project client"}
            </p>
            {(estimate.clientMailingAddress ??
              workspace.projectMailingAddress) && (
              <p className="whitespace-pre-line">
                {estimate.clientMailingAddress ??
                  workspace.projectMailingAddress}
              </p>
            )}
            <p className="mt-2 text-xs font-semibold uppercase tracking-wide">
              Estimate date
            </p>
            <p>{estimateDate(estimate.estimateDate, estimate.createdAt)}</p>
          </div>
        </section>

        {estimate.introductionText && (
          <section className="mt-6 whitespace-pre-wrap text-sm leading-6">
            {estimate.introductionText}
          </section>
        )}

        <ProjectEstimateReportPhases phases={phases} reportMode={workspace.reportMode} />

        <section className="ml-auto mt-6 w-full max-w-lg break-inside-avoid text-sm">
          {taxSummary.taxCents > 0 ? (
            <>
              <div className="flex justify-between border-t border-black py-2 font-semibold">
                <span>Project work before sales tax</span>
                <span>{money(clientPreTaxSubtotalCents)}</span>
              </div>
              <div className="border-l-2 border-black bg-neutral-100 py-1 pl-3">
                {taxSummary.groups.map((group) => (
                  <div className="flex justify-between py-1" key={group.key}>
                    <span>
                      Sales tax{group.label ? ` · ${group.label}` : ""} (
                      {percent(group.rateBasisPoints)})
                    </span>
                    <span className="ml-4 text-right font-semibold tabular-nums">
                      {money(group.taxCents)}
                    </span>
                  </div>
                ))}
                {taxSummary.groups.length > 1 && (
                  <div className="flex justify-between border-t border-neutral-400 py-1 font-semibold">
                    <span>Total sales tax</span>
                    <span className="ml-4 text-right tabular-nums">
                      {money(taxSummary.taxCents)}
                    </span>
                  </div>
                )}
              </div>
              <div className="flex justify-between border-t border-black py-2 font-semibold">
                <span>Project subtotal including sales tax</span>
                <span>{money(clientSubtotalCents)}</span>
              </div>
            </>
          ) : (
            <div className="flex justify-between border-t border-black py-2 font-semibold">
              <span>Project Subtotal:</span>
              <span>{money(clientSubtotalCents)}</span>
            </div>
          )}
          {estimate.builderFeeCents > 0 && (
            <>
              <div className="flex justify-between border-y border-black py-2 font-semibold">
                <span>Company Overhead &amp; Margin</span>
                <span>{percent(builderFeeRateBasisPoints)} Builder Fee</span>
              </div>
              {estimate.overheadRateBasisPoints > 0 && (
                <div className="flex justify-between py-1">
                  <span>
                    Company Overhead ({percent(estimate.overheadRateBasisPoints)})
                  </span>
                  <span>{money(estimate.overheadCents)}</span>
                </div>
              )}
              {estimate.marginRateBasisPoints > 0 && (
                <div className="flex justify-between py-1">
                  <span>
                    Company Margin ({percent(estimate.marginRateBasisPoints)})
                  </span>
                  <span>{money(estimate.marginCents)}</span>
                </div>
              )}
              {estimate.contingencyRateBasisPoints > 0 && (
                <div className="flex justify-between py-1">
                  <span>
                    Contingency Reserve ({percent(estimate.contingencyRateBasisPoints)})
                  </span>
                  <span>{money(estimate.contingencyCents)}</span>
                </div>
              )}
              <div className="flex justify-between border-t border-black py-2 font-semibold">
                <span>Total: Company Overhead &amp; Margin</span>
                <span>{money(estimate.builderFeeCents)}</span>
              </div>
            </>
          )}
          <div className="flex justify-between border-y-2 border-black py-2 text-base font-bold">
            <span>Project Total:</span>
            <span>{money(clientTotalCents)}</span>
          </div>
        </section>

        {builderFeeExclusions.lines.length > 0 && (
          <section className="mt-6 break-inside-avoid text-sm">
            <h2 className="border-b pb-1 text-sm font-bold uppercase tracking-wide">
              Builder-fee exclusions
            </h2>
            <p className="mt-2 text-xs text-neutral-600">
              The following items remain part of the project subtotal but are
              excluded from the overhead, margin, and contingency calculation.
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              {builderFeeExclusions.lines.map((line) => (
                <li key={line.id} className="break-inside-avoid">
                  <div className="flex justify-between gap-4">
                    <span>
                      {line.costCode} · {line.costCodeName}
                      {line.description.trim() !== line.costCodeName.trim()
                        ? ` — ${line.description}`
                        : ""}
                    </span>
                    <span className="shrink-0 text-right tabular-nums">
                      {money(line.lineTotalCents)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
            <div className="mt-2 flex justify-between border-t border-black pt-2 font-semibold">
              <span>Total exclusions</span>
              <span className="ml-4 text-right tabular-nums">
                {money(builderFeeExclusions.totalCents)}
              </span>
            </div>
          </section>
        )}

        {workspace.basisDocuments.length > 0 && (
          <section className="mt-8 break-inside-avoid">
            <h2 className="border-b pb-1 text-sm font-bold uppercase tracking-wide">
              Estimate basis
            </h2>
            <ul className="mt-2 space-y-1 text-sm">
              {workspace.basisDocuments.map((document) => (
                <li key={document.id}>
                  <span className="font-medium">{document.title}</span>
                  {document.documentDate ? ` - ${document.documentDate}` : ""}
                  {document.revision ? ` - revision ${document.revision}` : ""}
                </li>
              ))}
            </ul>
          </section>
        )}

        {estimate.contractTerms && (
          <section className="mt-8 break-inside-avoid">
            <h2 className="border-b pb-1 text-sm font-bold uppercase tracking-wide">
              Pertinent contract terms
            </h2>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-6">
              {estimate.contractTerms}
            </p>
          </section>
        )}

        {estimate.closingText && (
          <section className="mt-8 whitespace-pre-wrap text-sm leading-6">
            {estimate.closingText}
          </section>
        )}

        {workspace.selectedAcknowledgements.map((acknowledgement) => (
          <section
            key={acknowledgement.id}
            className="estimate-acknowledgement pt-2"
          >
            <div className="border-b-2 border-black pb-3">
              <p className="text-sm font-semibold">{brand.companyName}</p>
              <h2 className="mt-1 text-xl font-bold">
                {acknowledgement.title}
              </h2>
              <p className="mt-1 text-xs text-neutral-600">
                Appended to {estimate.estimateNumber}
              </p>
            </div>
            <div className="mt-5 whitespace-pre-wrap text-sm leading-6">
              {acknowledgement.body}
            </div>
          </section>
        ))}

        <section className="estimate-signature-page break-inside-avoid pt-2">
          <h2 className="border-b pb-1 text-sm font-bold uppercase tracking-wide">
            Acceptance and authorization
          </h2>
          <p className="mt-2 text-xs text-neutral-600">
            All listed client / owner signers and the company representative are required.
          </p>
          <div className="mt-5 grid grid-cols-2 gap-x-10 gap-y-5 text-sm">
            {estimate.clientSigners.map((signer, index) => (
              <div key={`${signer.email}-${index}`} className="break-inside-avoid">
                <p className="font-semibold">Client / Owner {index + 1}</p>
                <div className="mt-7 border-b border-black" />
                <p className="mt-1 text-xs">Signature</p>
                <p className="mt-2 font-medium">{signer.name}</p>
                {signer.title && <p className="text-xs">{signer.title}</p>}
                <div className="mt-4 border-b border-black" />
                <p className="mt-1 text-xs">Date</p>
              </div>
            ))}
            <div className="break-inside-avoid">
              <p className="text-[8px] font-semibold leading-3">
                {legalEntityName}
              </p>
              <div className="mt-7 flex items-end gap-2">
                <span className="text-xs font-semibold">By:</span>
                <div className="flex-1 border-b border-black" />
              </div>
              <p className="mt-2 text-xs">
                <span className="font-semibold">Name:</span>{" "}
                {estimate.companySignerName ?? "Company representative"}
              </p>
              <p className="text-xs">
                <span className="font-semibold">Title:</span>{" "}
                {estimate.companySignerTitle ?? "Title required"}
              </p>
              <div className="mt-12 border-b border-black" />
              <p className="mt-1 text-xs">Date</p>
            </div>
          </div>
        </section>

        <footer className="mt-10 border-t pt-3 text-xs text-neutral-600">
          Estimate {estimate.estimateNumber}, version {estimate.versionNumber}, dated{" "}
          {estimateDate(estimate.estimateDate, estimate.createdAt)}.
        </footer>

      </main>
    </>
  )
}
