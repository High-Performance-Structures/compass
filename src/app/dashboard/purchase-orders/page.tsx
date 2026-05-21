import Link from "next/link"
import {
  IconSearch,
  IconShoppingCart,
} from "@tabler/icons-react"

import { getProjects } from "@/app/actions/projects"
import { ProjectQuickSwitcher } from "@/components/projects/project-quick-switcher"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

export default async function PurchaseOrderProjectPickerPage() {
  const projects = await getProjects()

  return (
    <div className="flex-1 space-y-6 p-4 pt-6 sm:p-6 md:p-8">
      <div className="max-w-3xl">
        <div className="flex items-center gap-2">
          <IconShoppingCart className="size-5 text-muted-foreground" />
          <h1 className="text-2xl font-semibold tracking-tight">
            Purchase Orders
          </h1>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          Choose the project before preparing or reviewing a P.O. This keeps
          vendor commitments attached to the right job.
        </p>
      </div>

      <section className="rounded-xl border bg-emerald-50/80 p-4 text-emerald-950 dark:border-emerald-900/60 dark:bg-emerald-950/20 dark:text-emerald-100">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold">Project required first</p>
            <p className="mt-1 text-sm opacity-80">
              Start with the job, then prepare, print, email, or sync the P.O.
              from that project context.
            </p>
          </div>
          <Badge variant="secondary">PO context lock</Badge>
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">Select project</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Search by project number, name, client, or accounting context.
            </p>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link href="/dashboard/projects">
              <IconSearch className="size-4" />
              Browse projects
            </Link>
          </Button>
        </div>

        {projects.length > 0 ? (
          <div className="max-w-xl rounded-xl border bg-background p-4 shadow-sm">
            <ProjectQuickSwitcher
              projects={projects}
              targetSection="purchase-orders"
              placeholder="Search projects for POs..."
              className="w-full"
            />
            <p className="mt-3 text-xs text-muted-foreground">
              Choosing a project opens that project&apos;s PO workspace directly.
            </p>
          </div>
        ) : (
          <div className="rounded-lg border bg-background p-8 text-center">
            <IconShoppingCart className="mx-auto size-6 text-muted-foreground" />
            <h2 className="mt-3 text-sm font-semibold">No projects available</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Add projects before preparing purchase orders.
            </p>
          </div>
        )}
      </section>
    </div>
  )
}
