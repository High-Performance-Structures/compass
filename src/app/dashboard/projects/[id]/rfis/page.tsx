import Link from "next/link"
import { redirect } from "next/navigation"
import {
  IconArrowLeft,
  IconCircleCheck,
  IconClock,
  IconMessageQuestion,
  IconPlus,
} from "@tabler/icons-react"

import {
  createProjectRfi,
  getProjectRfis,
  updateProjectRfi,
} from "@/app/actions/project-rfis"
import { getProjects } from "@/app/actions/projects"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"

function readFormText(formData: FormData, name: string): string {
  const value = formData.get(name)
  return typeof value === "string" ? value : ""
}

function cleanFormText(formData: FormData, name: string): string | null {
  const value = readFormText(formData, name).trim()
  return value.length > 0 ? value : null
}

function formatDate(value: string | null): string {
  if (!value) return "No due date"
  return new Date(`${value}T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

function label(value: string): string {
  return value
    .split("_")
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ")
}

export default async function ProjectRfisPage({
  params,
}: {
  readonly params: Promise<{ readonly id: string }>
}) {
  const { id } = await params
  const [projects, rfis] = await Promise.all([getProjects(), getProjectRfis(id)])
  const project = projects.find((item) => item.id === id)
  const openCount = rfis.filter(
    (rfi) => !["answered", "closed", "void", "cancelled"].includes(rfi.status)
  ).length

  async function createRfiAction(formData: FormData): Promise<void> {
    "use server"

    const result = await createProjectRfi(id, {
      subject: readFormText(formData, "subject"),
      question: readFormText(formData, "question"),
      priority: readFormText(formData, "priority"),
      audience: readFormText(formData, "audience"),
      requesterName: cleanFormText(formData, "requesterName"),
      assignedToName: cleanFormText(formData, "assignedToName"),
      companyName: cleanFormText(formData, "companyName"),
      dueDate: cleanFormText(formData, "dueDate"),
    })

    if (!result.success) {
      throw new Error(result.error)
    }

    redirect(`/dashboard/projects/${id}/rfis`)
  }

  async function updateRfiAction(formData: FormData): Promise<void> {
    "use server"

    const result = await updateProjectRfi(
      id,
      readFormText(formData, "rfiId"),
      {
        answer: cleanFormText(formData, "answer"),
        status: readFormText(formData, "status"),
        audience: readFormText(formData, "audience"),
      }
    )

    if (!result.success) {
      throw new Error(result.error)
    }

    redirect(`/dashboard/projects/${id}/rfis`)
  }

  return (
    <div className="flex-1 space-y-6 p-4 pt-6 sm:p-6 md:p-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Button asChild variant="ghost" size="sm" className="-ml-2 mb-2">
            <Link href={`/dashboard/projects/${id}`}>
              <IconArrowLeft className="size-4" />
              Project
            </Link>
          </Button>
          <div className="flex items-center gap-2">
            <IconMessageQuestion className="size-5 text-muted-foreground" />
            <h1 className="text-2xl font-semibold tracking-tight">RFIs</h1>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {project?.projectNumber ? `${project.projectNumber} - ` : ""}
            {project?.name ?? "Project"} questions, answers, and visibility.
          </p>
        </div>
        <Badge variant={openCount > 0 ? "secondary" : "outline"}>
          {openCount} open
        </Badge>
      </div>

      <section className="rounded-xl border bg-emerald-50/80 p-4 text-emerald-950 dark:border-emerald-900/60 dark:bg-emerald-950/20 dark:text-emerald-100">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-medium uppercase opacity-70">
              Current RFI project
            </p>
            <h2 className="mt-1 text-lg font-semibold">
              {project?.projectNumber ? `${project.projectNumber} - ` : ""}
              {project?.name ?? "Project"}
            </h2>
            {project?.clientName && (
              <p className="mt-1 text-sm opacity-80">{project.clientName}</p>
            )}
          </div>
          <Button asChild variant="outline" size="sm">
            <Link href="/dashboard/rfis">Switch project</Link>
          </Button>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(20rem,26rem)_1fr]">
        <section className="rounded-lg border bg-background p-4">
          <div className="flex items-center gap-2">
            <IconPlus className="size-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">Create RFI</h2>
          </div>
          <form action={createRfiAction} className="mt-4 space-y-3">
            <Input name="subject" placeholder="Subject" required />
            <Textarea
              name="question"
              placeholder="Question, scope gap, or clarification needed"
              required
              className="min-h-28"
            />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Input name="companyName" placeholder="Company or trade" />
              <Input name="assignedToName" placeholder="Assigned to" />
              <Input name="requesterName" placeholder="Requested by" />
              <Input name="dueDate" type="date" />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <select
                name="priority"
                defaultValue="normal"
                className="h-9 rounded-md border bg-background px-3 text-sm"
              >
                <option value="normal">Normal priority</option>
                <option value="high">High priority</option>
                <option value="low">Low priority</option>
              </select>
              <select
                name="audience"
                defaultValue="internal"
                className="h-9 rounded-md border bg-background px-3 text-sm"
              >
                <option value="internal">Internal only</option>
                <option value="sub_vendor">Sub/vendor visible</option>
                <option value="owner">Owner visible</option>
                <option value="public">Owner and sub/vendor visible</option>
              </select>
            </div>
            <Button type="submit" className="w-full">
              Create RFI
            </Button>
          </form>
        </section>

        <section className="space-y-3">
          {rfis.length > 0 ? (
            rfis.map((rfi) => (
              <article key={rfi.id} className="rounded-lg border bg-background p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-muted-foreground">
                      {rfi.rfiNumber}
                    </p>
                    <h2 className="mt-1 text-base font-semibold">
                      {rfi.subject}
                    </h2>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    <Badge variant={rfi.status === "open" ? "secondary" : "outline"}>
                      {label(rfi.status)}
                    </Badge>
                    <Badge variant="outline">{label(rfi.audience)}</Badge>
                    {rfi.priority === "high" && (
                      <Badge variant="destructive">High</Badge>
                    )}
                  </div>
                </div>
                <p className="mt-3 text-sm text-muted-foreground">{rfi.question}</p>
                <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted-foreground">
                  {rfi.companyName && <span>{rfi.companyName}</span>}
                  {rfi.assignedToName && <span>Assigned: {rfi.assignedToName}</span>}
                  <span>Due {formatDate(rfi.dueDate)}</span>
                </div>

                <form action={updateRfiAction} className="mt-4 space-y-3">
                  <input type="hidden" name="rfiId" value={rfi.id} />
                  <Textarea
                    name="answer"
                    defaultValue={rfi.answer ?? ""}
                    placeholder="Answer, decision, or next step"
                  />
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_auto]">
                    <select
                      name="status"
                      defaultValue={rfi.status}
                      className="h-9 rounded-md border bg-background px-3 text-sm"
                    >
                      <option value="open">Open</option>
                      <option value="answered">Answered</option>
                      <option value="closed">Closed</option>
                      <option value="void">Void</option>
                    </select>
                    <select
                      name="audience"
                      defaultValue={rfi.audience}
                      className="h-9 rounded-md border bg-background px-3 text-sm"
                    >
                      <option value="internal">Internal only</option>
                      <option value="sub_vendor">Sub/vendor visible</option>
                      <option value="owner">Owner visible</option>
                      <option value="public">Owner and sub/vendor visible</option>
                    </select>
                    <Button type="submit" variant="outline">
                      <IconCircleCheck className="size-4" />
                      Save
                    </Button>
                  </div>
                </form>
              </article>
            ))
          ) : (
            <div className="rounded-lg border bg-background p-8 text-center">
              <IconClock className="mx-auto size-6 text-muted-foreground" />
              <h2 className="mt-3 text-sm font-semibold">No RFIs yet</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Create the first clarification from this project context.
              </p>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
