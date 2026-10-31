"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { IconPlus } from "@tabler/icons-react"
import { toast } from "sonner"
import { createInternalWorkspace } from "@/app/actions/internal-workspaces"
import { useDepartmentProfiles } from "@/components/branding/department-profiles-provider"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { DEPARTMENT_CODES } from "@/lib/department-profiles"
import { WORKSPACE_KINDS } from "@/lib/domain/project/statuses"
import { isWorkspaceKind, WORKSPACE_KIND_LABELS, type WorkspaceKind } from "@/lib/internal-duties/model"
import { isProjectDepartment, type ProjectDepartment } from "@/lib/project-branding"

/** Adds an office, owner's office or yard workspace under the Internal department. */
export function InternalWorkspaceCreateButton({
  departmentName,
}: {
  readonly departmentName: string
}): React.ReactElement {
  const router = useRouter()
  const profiles = useDepartmentProfiles()
  const [open, setOpen] = React.useState(false)
  const [name, setName] = React.useState("")
  const [kind, setKind] = React.useState<WorkspaceKind>("office")
  const [department, setDepartment] = React.useState<ProjectDepartment>("H")
  const [projectNumber, setProjectNumber] = React.useState("")
  const [pending, startTransition] = React.useTransition()

  function submit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    startTransition(async () => {
      const result = await createInternalWorkspace({
        name,
        workspaceKind: kind,
        department,
        projectNumber: projectNumber.trim() || null,
      })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success(`${name.trim()} added to ${departmentName}.`)
      setOpen(false)
      setName("")
      setProjectNumber("")
      router.push(`/dashboard/projects/${result.data.projectId}`)
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline">
          <IconPlus className="size-4" aria-hidden="true" />
          New internal workspace
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>New internal workspace</DialogTitle>
            <DialogDescription>
              Listed under {departmentName}. It has no client, estimate or Drive folder, and never shows in client follow-up.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="internal-workspace-name">Name</Label>
            <Input
              id="internal-workspace-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Main office"
              maxLength={120}
              required
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="internal-workspace-kind">Type</Label>
            <Select value={kind} onValueChange={(value) => isWorkspaceKind(value) && setKind(value)}>
              <SelectTrigger id="internal-workspace-kind" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {WORKSPACE_KINDS.map((item) => (
                  <SelectItem key={item} value={item}>{WORKSPACE_KIND_LABELS[item]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">Sets which duties people log there (Settings → Workflows → Daily logs).</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="internal-workspace-department">Belongs to</Label>
              <Select value={department} onValueChange={(value) => isProjectDepartment(value) && setDepartment(value)}>
                <SelectTrigger id="internal-workspace-department" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DEPARTMENT_CODES.map((code) => (
                    <SelectItem key={code} value={code}>{profiles[code].shortName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="internal-workspace-number">Number (optional)</Label>
              <Input
                id="internal-workspace-number"
                value={projectNumber}
                onChange={(event) => setProjectNumber(event.target.value)}
                placeholder="H-OFFICE"
                maxLength={40}
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || name.trim().length < 2}>
              Add workspace
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
