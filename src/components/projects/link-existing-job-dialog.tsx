"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { IconLink } from "@tabler/icons-react"
import { toast } from "sonner"

import { linkExistingProject } from "@/app/actions/project-links"
import { ProjectJobPicker } from "@/components/projects/project-job-picker"
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

/**
 * "Link existing job": links this job to one that already exists, such as
 * a Design job and the Construction job it led to. Nothing is renumbered or
 * copied.
 */
export function LinkExistingJobDialog({
  projectId,
  linkedProjectIds,
}: {
  readonly projectId: string
  readonly linkedProjectIds: readonly string[]
}): React.ReactElement {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [otherProjectId, setOtherProjectId] = React.useState("")
  const [label, setLabel] = React.useState("")
  const [pending, startTransition] = React.useTransition()
  const excludeIds = React.useMemo(() => [projectId, ...linkedProjectIds], [projectId, linkedProjectIds])

  function reset(next: boolean): void {
    setOpen(next)
    if (!next) {
      setOtherProjectId("")
      setLabel("")
    }
  }

  function submit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    if (!otherProjectId) return
    startTransition(async () => {
      const result = await linkExistingProject(projectId, otherProjectId, label || null)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success("Job linked.")
      reset(false)
      router.refresh()
    })
  }

  return (
    <Dialog open={open} onOpenChange={reset}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          <IconLink className="size-4" />
          Link existing job
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Link existing job</DialogTitle>
            <DialogDescription>
              Both jobs keep their numbers and records and show the link on their dashboards.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="link-existing-job">Job</Label>
            <ProjectJobPicker
              id="link-existing-job"
              value={otherProjectId}
              onValueChange={setOtherProjectId}
              excludeIds={excludeIds}
              disabled={pending}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="link-existing-job-label">What the link is for (optional)</Label>
            <Input
              id="link-existing-job-label"
              value={label}
              maxLength={80}
              placeholder="Design to construction"
              onChange={(event) => setLabel(event.target.value)}
              disabled={pending}
            />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={pending || !otherProjectId}>
              {pending ? "Linking..." : "Link job"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
