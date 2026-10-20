"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { updateProjectWorkspace } from "@/app/actions/internal-workspaces"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { isWorkspaceKind, WORKSPACE_KIND_LABELS, WORKSPACE_KINDS, type WorkspaceKind } from "@/lib/internal-duties/model"

const CLIENT_JOB = "client"

/**
 * Whether a project is a client job or an internal workspace (office, owner's
 * office, yard), and whether it's listed under the Internal department.
 */
export function ProjectWorkspaceSettings({
  projectId,
  workspaceKind,
  internalDepartment,
  internalDepartmentName,
}: {
  readonly projectId: string
  readonly workspaceKind: WorkspaceKind | null
  readonly internalDepartment: boolean
  readonly internalDepartmentName: string
}): React.ReactElement {
  const router = useRouter()
  const [kind, setKind] = React.useState<WorkspaceKind | null>(workspaceKind)
  const [listed, setListed] = React.useState(internalDepartment)
  const [pending, startTransition] = React.useTransition()
  const changed = kind !== workspaceKind || listed !== internalDepartment

  function save(): void {
    startTransition(async () => {
      const result = await updateProjectWorkspace({ projectId, workspaceKind: kind, internalDepartment: kind !== null && listed })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success("Workspace settings saved.")
      router.refresh()
    })
  }

  return (
    <section aria-labelledby="project-workspace-title" className="space-y-4 border-t pt-5">
      <div>
        <h2 id="project-workspace-title" className="font-semibold">Job or internal workspace</h2>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Internal workspaces have no client, estimates or project folders. People log duties there instead of cost codes, and
          they never show in client follow-up.
        </p>
      </div>
      <div className="grid max-w-3xl gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="project-workspace-kind">Type</Label>
          <Select
            value={kind ?? CLIENT_JOB}
            disabled={pending}
            onValueChange={(value) => {
              if (value === CLIENT_JOB) {
                setKind(null)
                setListed(false)
              } else if (isWorkspaceKind(value)) {
                setKind(value)
              }
            }}
          >
            <SelectTrigger id="project-workspace-kind" className="h-9 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={CLIENT_JOB}>Client job</SelectItem>
              {WORKSPACE_KINDS.map((item) => (
                <SelectItem key={item} value={item}>{WORKSPACE_KIND_LABELS[item]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-start justify-between gap-4 md:pt-6">
          <div>
            <Label htmlFor="project-workspace-internal">List under {internalDepartmentName}</Label>
            <p className="text-xs text-muted-foreground">
              Off keeps it under its own department, like a crew workspace for one department&apos;s orders.
            </p>
          </div>
          <Switch
            id="project-workspace-internal"
            checked={kind !== null && listed}
            disabled={pending || kind === null}
            onCheckedChange={setListed}
          />
        </div>
      </div>
      <div className="flex justify-end">
        <Button type="button" variant="outline" disabled={pending || !changed} onClick={save}>
          Save workspace settings
        </Button>
      </div>
    </section>
  )
}
