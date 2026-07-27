import { IconShoppingCart } from "@tabler/icons-react"

import { getProjects } from "@/app/actions/projects"
import { ActiveProjectSectionRedirect } from "@/components/projects/active-project-section-redirect"
import { ProjectContextWatermarkShell } from "@/components/projects/project-context-watermark-shell"
import { ProjectQuickSwitcher } from "@/components/projects/project-quick-switcher"
import { Badge } from "@/components/ui/badge"

export default async function PurchaseOrderProjectPickerPage() {
  const projects = await getProjects()

  return (
    <ProjectContextWatermarkShell>
      <div className="max-w-3xl">
        <div className="flex items-center gap-2">
          <IconShoppingCart className="size-5 text-muted-foreground" />
          <h1 className="text-2xl font-semibold tracking-tight">
            Purchase Orders
          </h1>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          Choose a project before preparing or reviewing a P.O.
        </p>
      </div>

      <section className="clarity-panel border-l-[6px] border-l-brand-hps-primary p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold">Project required first</p>
            <p className="mt-1 text-sm opacity-80">
              Keeps vendor commitments tied to the right job.
            </p>
          </div>
          <Badge variant="secondary">Project lock</Badge>
        </div>
      </section>

      <ActiveProjectSectionRedirect
        targetSection="purchase-orders"
        label="Open POs"
      />

      <section className="space-y-3">
        <div>
          <div>
            <h2 className="text-sm font-semibold">Select project</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Search by project number, name, client, or accounting context.
            </p>
          </div>
        </div>

        {projects.length > 0 ? (
          <div className="max-w-xl rounded-lg border bg-background p-4 shadow-sm">
            <ProjectQuickSwitcher
              projects={projects}
              targetSection="purchase-orders"
              placeholder="Search projects for POs..."
              className="w-full"
            />
            <p className="mt-3 text-xs text-muted-foreground">
              Opens the PO queue for the selected project.
            </p>
          </div>
        ) : (
          <div className="rounded-lg border bg-background p-8 text-center">
            <IconShoppingCart className="mx-auto size-6 text-muted-foreground" />
            <h2 className="mt-3 text-sm font-semibold">No projects available</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Add or sync projects first.
            </p>
          </div>
        )}
      </section>
    </ProjectContextWatermarkShell>
  )
}
