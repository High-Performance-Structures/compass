import Link from "next/link"
import {
  IconArrowRight,
  IconBuildingCommunity,
  IconMessageQuestion,
  IconSearch,
} from "@tabler/icons-react"

import { getProjects } from "@/app/actions/projects"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

export default async function RfiProjectPickerPage() {
  const projects = await getProjects()

  return (
    <div className="flex-1 space-y-6 p-4 pt-6 sm:p-6 md:p-8">
      <div className="max-w-3xl">
        <div className="flex items-center gap-2">
          <IconMessageQuestion className="size-5 text-muted-foreground" />
          <h1 className="text-2xl font-semibold tracking-tight">RFIs</h1>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          Choose the project before creating or answering an RFI. Compass keeps
          the form locked behind a project selection so questions stay attached
          to the right job.
        </p>
      </div>

      <section className="rounded-xl border bg-amber-50/80 p-4 text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-100">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold">Project required first</p>
            <p className="mt-1 text-sm opacity-80">
              If a subcontractor works on more than one job, this screen should
              be their pause point before they type the question.
            </p>
          </div>
          <Badge variant="secondary">Wrong-job protection</Badge>
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">Select project</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Open the RFI queue for the job you mean to work in.
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
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {projects.map((project) => (
              <Link
                key={project.id}
                href={`/dashboard/projects/${project.id}/rfis`}
                className="group flex min-h-36 flex-col justify-between rounded-lg border bg-background p-4 shadow-sm transition-all hover:-translate-y-1 hover:border-emerald-300 hover:bg-emerald-50/60 hover:shadow-md dark:hover:border-emerald-900 dark:hover:bg-emerald-950/20"
              >
                <div>
                  <div className="flex items-start justify-between gap-3">
                    <IconBuildingCommunity className="size-5 shrink-0 text-muted-foreground" />
                    <Badge variant="outline">
                      {project.projectNumber ?? "No number"}
                    </Badge>
                  </div>
                  <h3 className="mt-4 text-base font-semibold">
                    {project.name}
                  </h3>
                  {project.clientName && (
                    <p className="mt-1 text-sm text-muted-foreground">
                      {project.clientName}
                    </p>
                  )}
                </div>
                <div className="mt-4 flex items-center justify-between text-sm font-medium">
                  <span>Open RFIs</span>
                  <IconArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <div className="rounded-lg border bg-background p-8 text-center">
            <IconMessageQuestion className="mx-auto size-6 text-muted-foreground" />
            <h2 className="mt-3 text-sm font-semibold">No projects available</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Add or sync projects before creating RFIs.
            </p>
          </div>
        )}
      </section>
    </div>
  )
}
