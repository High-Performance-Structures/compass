"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { IconPlus } from "@tabler/icons-react"
import { toast } from "sonner"

import { createEstimateTemplateDraft } from "@/app/actions/estimate-templates"
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
import { Textarea } from "@/components/ui/textarea"

export function EstimateTemplateCreateDialog(): React.ReactElement {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()

  function create(formData: FormData): void {
    startTransition(async () => {
      const result = await createEstimateTemplateDraft({
        name: String(formData.get("name") ?? ""),
        description: String(formData.get("description") ?? ""),
        departmentCode: String(formData.get("departmentCode") ?? ""),
      })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      setOpen(false)
      router.push(`/dashboard/templates/${result.id}`)
      router.refresh()
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <IconPlus className="size-4" />
          New estimate template
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <form action={create}>
          <DialogHeader>
            <DialogTitle>New estimate template</DialogTitle>
            <DialogDescription>
              Create an editable draft. It will not appear in project estimates
              until it is reviewed and published.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-5">
            <div className="space-y-1.5">
              <Label htmlFor="template-name">Template name</Label>
              <Input
                id="template-name"
                name="name"
                placeholder="Custom home construction estimate"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="template-department">Department</Label>
              <Input
                id="template-department"
                name="departmentCode"
                placeholder="ORC, Design, HPS, or Nu-Tech"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="template-description">Description</Label>
              <Textarea
                id="template-description"
                name="description"
                rows={3}
                placeholder="When staff should choose this template."
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              Create editable draft
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
