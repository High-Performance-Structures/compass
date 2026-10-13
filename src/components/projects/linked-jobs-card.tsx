"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { IconLink, IconUnlink } from "@tabler/icons-react"
import { toast } from "sonner"

import { removeProjectLink, type ProjectLinksView } from "@/app/actions/project-links"
import type { ProjectIntakeAssignee } from "@/app/actions/projects"
import { ProjectIntakeDrawer, type LinkedProjectIntake } from "@/components/projects/project-intake-drawer"
import { Button } from "@/components/ui/button"
import type { ProjectIntakeDepartment } from "@/lib/google/project-intake-tracker"

const INTAKE_DEPARTMENTS: readonly ProjectIntakeDepartment[] = ["O", "H", "N", "D"]

function isIntakeDepartment(value: string): value is ProjectIntakeDepartment {
  return INTAKE_DEPARTMENTS.some((department) => department === value)
}

/**
 * Jobs linked to this one (an upsell or downsell for the same customer and
 * site), both the ones created from it and the one it came from, with
 * shortcuts to create another.
 */
export function LinkedJobsCard({
  projectId,
  view,
  assignees,
  departmentNames,
}: {
  readonly projectId: string
  readonly view: ProjectLinksView
  readonly assignees: readonly ProjectIntakeAssignee[]
  readonly departmentNames: Readonly<Record<string, string>>
}): React.ReactElement | null {
  const router = useRouter()
  const [pending, startTransition] = React.useTransition()
  if (view.links.length === 0 && !view.canCreate) return null

  function intake(
    department: ProjectIntakeDepartment,
    label: string | null,
    triggerLabel: string,
    workItems: readonly string[],
  ): LinkedProjectIntake {
    const source = view.prefill.sourceProjectNumber ?? "the original job"
    return {
      sourceProjectId: view.prefill.sourceProjectId,
      sourceProjectNumber: view.prefill.sourceProjectNumber,
      label,
      triggerLabel,
      defaults: {
        department,
        projectName: label ? `${view.prefill.projectName} · ${label}` : view.prefill.projectName,
        existingCustomerId: view.prefill.existingCustomerId,
        clientName: view.prefill.clientName,
        contactPhone: view.prefill.contactPhone,
        contactEmail: view.prefill.contactEmail,
        streetNumber: view.prefill.streetNumber,
        streetName: view.prefill.streetName,
        cityStateZip: view.prefill.cityStateZip,
        billingAddress: view.prefill.billingAddress,
        notes: [`Linked from ${source}.`, workItems.length > 0 ? `Work requested: ${workItems.join(", ")}.` : null]
          .filter(Boolean)
          .join("\n"),
      },
    }
  }

  function unlink(linkId: string, name: string): void {
    if (!window.confirm(`Remove the link to ${name}? Both jobs stay as they are.`)) return
    startTransition(async () => {
      const result = await removeProjectLink(projectId, linkId)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success("Link removed.")
      router.refresh()
    })
  }

  return (
    <section aria-labelledby="linked-jobs-heading" className="clarity-panel grid gap-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="linked-jobs-heading" className="flex items-center gap-2 text-sm font-semibold">
          <IconLink className="size-4" />
          Linked jobs
        </h2>
        {view.canCreate ? (
          <div className="flex flex-wrap gap-2">
            {view.shortcuts.map((shortcut) =>
              isIntakeDepartment(shortcut.toDepartment) ? (
                <ProjectIntakeDrawer
                  key={shortcut.id}
                  assignees={assignees}
                  linked={intake(shortcut.toDepartment, shortcut.label, shortcut.label, shortcut.workItems)}
                />
              ) : null,
            )}
            <ProjectIntakeDrawer
              assignees={assignees}
              linked={intake(view.shortcuts[0]?.toDepartment && isIntakeDepartment(view.shortcuts[0].toDepartment) ? view.shortcuts[0].toDepartment : "H", null, "Other department…", [])}
            />
          </div>
        ) : null}
      </div>
      {view.links.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Work this customer wants from another department gets its own job, linked here, with the same customer and site.
        </p>
      ) : (
        <ul className="grid gap-2">
          {view.links.map((link) => (
            <li key={link.linkId} className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-muted/40 px-3 py-2.5">
              <div className="min-w-0">
                <div className="font-mono text-xs text-muted-foreground">
                  {link.projectNumber ?? "No number yet"}
                  {link.projectNumber ? ` · ${departmentNames[link.projectNumber.charAt(0)] ?? ""}` : ""}
                </div>
                <Link href={`/dashboard/projects/${encodeURIComponent(link.projectId)}`} className="font-medium hover:underline">
                  {link.name}
                </Link>
                <div className="text-xs text-muted-foreground">
                  {link.direction === "created" ? "Created from this job" : "This job was created from it"}
                  {link.label ? ` · ${link.label}` : ""}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">{link.statusLabel}</span>
                {view.canUnlink ? (
                  <Button type="button" variant="ghost" size="icon" aria-label={`Remove the link to ${link.name}`} disabled={pending} onClick={() => unlink(link.linkId, link.name)}>
                    <IconUnlink className="size-4" />
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
