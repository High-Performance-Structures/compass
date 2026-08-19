export const dynamic = "force-dynamic"

import { getProjectEstimateWorkspace } from "@/app/actions/project-estimates"
import { getProjects } from "@/app/actions/projects"
import { ProjectBrandLogo } from "@/components/projects/project-brand-logo"
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
  const divisions = new Map<string, typeof workspace.lines>()
  for (const line of workspace.lines) {
    const current = divisions.get(line.divisionCode) ?? []
    divisions.set(line.divisionCode, [...current, line])
  }

  if (!estimate) {
    return <main className="p-8">Estimate not found.</main>
  }

  return (
    <main className="mx-auto max-w-[8.5in] bg-white p-8 text-black print:max-w-none print:p-0">
      <header className="flex items-start justify-between gap-6 border-b-2 border-black pb-5">
        <div className="flex items-center gap-4">
          <ProjectBrandLogo
            brand={brand}
            size={80}
            className="size-20 object-contain"
          />
          <div>
            <p className="text-lg font-bold">{brand.companyName}</p>
            {brand.mailingAddress.map((line) => (
              <p key={line} className="text-sm">{line}</p>
            ))}
          </div>
        </div>
        <div className="text-right">
          <h1 className="text-xl font-bold">CA22 Construction Estimate</h1>
          <p className="mt-1 text-sm">{estimate.estimateNumber}</p>
          <p className="text-sm">Version {estimate.versionNumber}</p>
        </div>
      </header>

      <section className="mt-5 grid grid-cols-2 gap-6 text-sm">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide">Project</p>
          <p className="mt-1 font-semibold">{project?.name ?? workspace.projectName}</p>
          <p>{workspace.projectNumber}</p>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide">Prepared for</p>
          <p className="mt-1 font-semibold">{estimate.clientName ?? "Project owner"}</p>
          <p>{estimate.estimateDate ?? ""}</p>
        </div>
      </section>

      <section className="mt-6">
        <div className="grid grid-cols-[1fr_1.2in] border-b border-black pb-1 text-xs font-semibold uppercase tracking-wide">
          <span>CSI division and cost code</span>
          <span className="text-right">Amount</span>
        </div>
        {[...divisions.entries()].map(([divisionCode, lines]) => {
          const subtotal = lines.reduce((sum, line) => sum + line.lineTotalCents, 0)
          return (
            <div key={divisionCode} className="break-inside-avoid border-b py-3">
              <div className="flex items-center justify-between gap-3 font-semibold">
                <span>{divisionCode} · {lines[0]?.divisionName}</span>
                <span>{money(subtotal)}</span>
              </div>
              <div className="mt-1 space-y-1">
                {lines.map((line) => (
                  <div key={line.id} className="grid grid-cols-[1fr_1.2in] gap-3 text-sm">
                    <div>
                      <span className="font-medium">{line.costCode}</span>
                      <span> · {line.description}</span>
                      {line.specifications && <p className="text-xs text-neutral-600">{line.specifications}</p>}
                    </div>
                    <span className="text-right">{money(line.lineTotalCents)}</span>
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </section>

      <section className="ml-auto mt-5 w-full max-w-sm space-y-1 text-sm">
        <div className="flex justify-between"><span>Direct cost</span><span>{money(estimate.directCostCents)}</span></div>
        <div className="flex justify-between"><span>Line markup</span><span>{money(estimate.markupCents)}</span></div>
        <div className="flex justify-between"><span>Sales tax</span><span>{money(estimate.taxCents)}</span></div>
        <div className="flex justify-between border-t border-black pt-2 text-base font-bold"><span>Construction estimate</span><span>{money(estimate.estimateTotalCents)}</span></div>
      </section>

      {workspace.basisDocuments.length > 0 && (
        <section className="mt-8 break-inside-avoid">
          <h2 className="border-b pb-1 text-sm font-bold uppercase tracking-wide">Estimate basis</h2>
          <ul className="mt-2 space-y-1 text-sm">
            {workspace.basisDocuments.map((document) => (
              <li key={document.id}>
                <span className="font-medium">{document.title}</span>
                {document.documentDate ? ` · ${document.documentDate}` : ""}
                {document.revision ? ` · revision ${document.revision}` : ""}
              </li>
            ))}
          </ul>
        </section>
      )}

      {estimate.contractTerms && (
        <section className="mt-8 break-inside-avoid">
          <h2 className="border-b pb-1 text-sm font-bold uppercase tracking-wide">Pertinent contract terms</h2>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-6">{estimate.contractTerms}</p>
        </section>
      )}

      <footer className="mt-10 border-t pt-3 text-xs text-neutral-600">
        Accepted estimate versions are locked in Compass. Revisions to the contract
        sum are recorded through executed change orders and the G703.
      </footer>
    </main>
  )
}
