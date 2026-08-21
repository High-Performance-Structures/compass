export const dynamic = "force-dynamic"

import { getProjectEstimateWorkspace } from "@/app/actions/project-estimates"
import { getProjects } from "@/app/actions/projects"
import { ProjectBrandContactDetails } from "@/components/projects/project-brand-contact-details"
import { ProjectBrandLogo } from "@/components/projects/project-brand-logo"
import { ProjectEstimateReportActions } from "@/components/projects/project-estimate-report-actions"
import { clientEstimatePhases } from "@/lib/estimates/client-report"
import { projectBrandFor } from "@/lib/project-branding"

function money(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(cents / 100)
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
  const visibleLines = phases.flatMap((phase) => phase.lines)

  return (
    <>
      <style>{`
        @page { size: letter; margin: 0.55in; }
        @media print {
          body { background: white !important; }
          .estimate-report-actions { display: none !important; }
          .estimate-report { margin: 0 !important; max-width: none !important; padding: 0 !important; }
          .estimate-acknowledgement { break-before: page; }
        }
      `}</style>
      <ProjectEstimateReportActions
        title={estimate.title}
        estimateNumber={estimate.estimateNumber}
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
            <p>{estimate.estimateDate ?? ""}</p>
          </div>
        </section>

        {estimate.introductionText && (
          <section className="mt-6 whitespace-pre-wrap text-sm leading-6">
            {estimate.introductionText}
          </section>
        )}

        {workspace.reportMode === "phase_summary" && (
          <section className="mt-6">
            <div className="grid grid-cols-[1fr_1.2in] border-b border-black pb-1 text-xs font-semibold uppercase tracking-wide">
              <span>Phase description</span>
              <span className="text-right">Subtotal</span>
            </div>
            {phases.map((phase) => (
              <div
                key={phase.divisionCode}
                className="grid break-inside-avoid grid-cols-[1fr_1.2in] gap-3 border-b py-3 text-sm"
              >
                <div>
                  <p className="font-semibold">{phase.description}</p>
                  <p className="text-xs text-neutral-600">
                    Phase {phase.divisionCode}
                  </p>
                </div>
                <span className="text-right font-semibold">
                  {money(phase.subtotalCents)}
                </span>
              </div>
            ))}
          </section>
        )}

        {workspace.reportMode === "ca22" && (
          <section className="mt-6">
            <div className="grid grid-cols-[1fr_1.2in] border-b border-black pb-1 text-xs font-semibold uppercase tracking-wide">
              <span>Phase and cost code</span>
              <span className="text-right">Amount</span>
            </div>
            {phases.map((phase) => (
              <div
                key={phase.divisionCode}
                className="break-inside-avoid border-b py-3"
              >
                <div className="flex items-start justify-between gap-3 font-semibold">
                  <div>
                    <p>{phase.description}</p>
                    <p className="text-xs font-normal text-neutral-600">
                      Phase {phase.divisionCode}
                    </p>
                  </div>
                  <span>{money(phase.subtotalCents)}</span>
                </div>
                <div className="mt-2 space-y-1.5">
                  {phase.lines.map((line) => (
                    <div
                      key={line.id}
                      className="grid grid-cols-[1fr_1.2in] gap-3 pl-3 text-sm"
                    >
                      <div>
                        <span className="font-medium">{line.costCode}</span>
                        <span> - {line.description}</span>
                        {line.specifications && (
                          <p className="text-xs text-neutral-600">
                            {line.specifications}
                          </p>
                        )}
                      </div>
                      <span className="text-right">
                        {money(line.lineTotalCents)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </section>
        )}

        {workspace.reportMode === "cost_code" && (
          <section className="mt-6">
            <div className="grid grid-cols-[1fr_1.2in] border-b border-black pb-1 text-xs font-semibold uppercase tracking-wide">
              <span>Cost code and description</span>
              <span className="text-right">Amount</span>
            </div>
            {visibleLines.map((line) => (
              <div
                key={line.id}
                className="grid break-inside-avoid grid-cols-[1fr_1.2in] gap-3 border-b py-3 text-sm"
              >
                <div>
                  <span className="font-medium">{line.costCode}</span>
                  <span> - {line.description}</span>
                  {line.specifications && (
                    <p className="text-xs text-neutral-600">
                      {line.specifications}
                    </p>
                  )}
                </div>
                <span className="text-right font-medium">
                  {money(line.lineTotalCents)}
                </span>
              </div>
            ))}
          </section>
        )}

        <section className="ml-auto mt-5 w-full max-w-sm text-sm">
          <div className="flex justify-between border-t border-black pt-2 text-base font-bold">
            <span>Estimate total</span>
            <span>{money(estimate.estimateTotalCents)}</span>
          </div>
        </section>

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

        <footer className="mt-10 border-t pt-3 text-xs text-neutral-600">
          Estimate {estimate.estimateNumber}, version {estimate.versionNumber}.
        </footer>

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
      </main>
    </>
  )
}
