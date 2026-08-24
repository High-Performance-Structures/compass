export const dynamic = "force-dynamic"

import { Fragment } from "react"

import { getProjectEstimateWorkspace } from "@/app/actions/project-estimates"
import { getProjects } from "@/app/actions/projects"
import { ProjectBrandContactDetails } from "@/components/projects/project-brand-contact-details"
import { ProjectBrandLogo } from "@/components/projects/project-brand-logo"
import { ProjectEstimateReportActions } from "@/components/projects/project-estimate-report-actions"
import { clientEstimatePhases } from "@/lib/estimates/client-report"
import { projectBrandFor, projectLegalEntityName } from "@/lib/project-branding"

function money(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(cents / 100)
}

function quantity(value: number): string {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 4,
  }).format(value)
}

function percent(basisPoints: number): string {
  return `${(basisPoints / 100).toFixed(2)}%`
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
  const [{ id }, query] = await Promise.all([params, searchParams])
  const [workspace, projects] = await Promise.all([
    getProjectEstimateWorkspace(id, query.estimateId),
    getProjects(),
  ])
  const estimate = workspace.activeEstimate
  const project = projects.find((item) => item.id === id)
  const brand = projectBrandFor({
    projectId: id,
    projectNumber: workspace.projectNumber,
  })
  const legalEntityName = projectLegalEntityName(brand.department)

  if (!estimate) {
    return <main className="p-8">Estimate not found.</main>
  }

  const phaseDescriptions = Object.fromEntries(
    workspace.phaseDescriptions.map((item) => [
      item.divisionCode,
      item.description,
    ])
  )
  const phases = clientEstimatePhases({
    lines: workspace.lines,
    phaseDescriptions,
  })
  const clientSubtotalCents = phases.reduce(
    (total, phase) => total + phase.subtotalCents,
    0
  )
  const clientTotalCents = clientSubtotalCents + estimate.builderFeeCents
  const builderFeeRateBasisPoints =
    estimate.overheadRateBasisPoints +
    estimate.marginRateBasisPoints +
    estimate.contingencyRateBasisPoints
  const builderFeeExclusions = phases.flatMap((phase) =>
    phase.lines.filter((line) => !line.includeInBuilderFee)
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
            <p className="mt-1 font-semibold">
              {project?.name ?? workspace.projectName}
            </p>
            <p>{workspace.projectNumber}</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide">
              Prepared for
            </p>
            <p className="mt-1 font-semibold">
              {estimate.clientName ?? "Project client"}
            </p>
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

        {(workspace.reportMode === "division_summary" ||
          workspace.reportMode === "phase_summary") && (
          <section className="mt-6">
            <div className="grid grid-cols-[1fr_1.2in] border-b border-black pb-1 text-xs font-semibold uppercase tracking-wide">
              <span>
                {workspace.reportMode === "phase_summary"
                  ? "Phase description"
                  : "Division"}
              </span>
              <span className="text-right">Subtotal</span>
            </div>
            {phases.map((phase) => (
              <div
                key={phase.divisionCode}
                className="grid break-inside-avoid grid-cols-[1fr_1.2in] gap-3 border-b py-3 text-sm"
              >
                <div>
                  <p className="font-semibold">
                    {workspace.reportMode === "phase_summary"
                      ? phase.description
                      : phase.divisionName}
                  </p>
                  <p className="text-xs text-neutral-600">
                    {workspace.reportMode === "phase_summary"
                      ? "Phase"
                      : "Division"}{" "}
                    {phase.divisionCode}
                  </p>
                </div>
                <span className="text-right font-semibold">
                  {money(phase.subtotalCents)}
                </span>
              </div>
            ))}
          </section>
        )}

        {workspace.reportMode === "line_items" && (
          <section className="mt-6">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-black text-left text-xs font-semibold uppercase tracking-wide">
                  <th className="pb-1 pr-2">Cost code</th>
                  <th className="pb-1 pr-2">Description</th>
                  <th className="pb-1 pr-2 text-right">Quantity</th>
                  <th className="pb-1 pr-2">Unit</th>
                  <th className="pb-1 pr-2 text-right">Unit cost</th>
                  <th className="pb-1 text-right">Total cost</th>
                </tr>
              </thead>
              <tbody>
            {phases.map((phase) => (
              <Fragment key={phase.divisionCode}>
                <tr className="break-inside-avoid border-b bg-neutral-100 font-semibold">
                  <td className="py-2 pr-2" colSpan={6}>
                    {phase.divisionCode} · {phase.description}
                  </td>
                </tr>
                  {phase.lines.map((line) => (
                    <tr
                      key={line.id}
                      className="break-inside-avoid border-b"
                    >
                      <td className="py-2 pr-2 align-top font-medium">
                        {line.costCode}
                      </td>
                      <td className="py-2 pr-2 align-top">
                        <p>{line.description}</p>
                        {!line.includeInBuilderFee && (
                          <p className="mt-1 text-xs italic text-neutral-600">
                            Included in project cost; excluded from builder-fee calculation.
                          </p>
                        )}
                      </td>
                      <td className="py-2 pr-2 text-right align-top">
                        {quantity(line.quantity)}
                      </td>
                      <td className="py-2 pr-2 align-top">{line.unit}</td>
                      <td className="py-2 pr-2 text-right align-top">
                        {money(line.unitCostCents)}
                      </td>
                      <td className="py-2 text-right align-top">
                        {money(line.lineTotalCents)}
                      </td>
                    </tr>
                  ))}
                <tr className="break-inside-avoid border-b-2 border-black font-semibold">
                  <td className="py-2" colSpan={5}>
                    Total: {phase.divisionCode} · {phase.description}
                  </td>
                  <td className="py-2 text-right">
                    {money(phase.subtotalCents)}
                  </td>
                </tr>
              </Fragment>
            ))}
              </tbody>
            </table>
          </section>
        )}

        <section className="ml-auto mt-6 w-full max-w-lg break-inside-avoid text-sm">
          <div className="flex justify-between border-t border-black py-2 font-semibold">
            <span>Project Subtotal:</span>
            <span>{money(clientSubtotalCents)}</span>
          </div>
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

        {builderFeeExclusions.length > 0 && (
          <section className="mt-6 break-inside-avoid text-sm">
            <h2 className="border-b pb-1 text-sm font-bold uppercase tracking-wide">
              Builder-fee exclusions
            </h2>
            <p className="mt-2 text-xs text-neutral-600">
              The following items remain part of the project subtotal but are
              excluded from the overhead, margin, and contingency calculation.
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              {builderFeeExclusions.map((line) => (
                <li key={line.id}>{line.costCode} · {line.description}</li>
              ))}
            </ul>
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
