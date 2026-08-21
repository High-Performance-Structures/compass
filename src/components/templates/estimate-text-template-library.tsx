"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState, useTransition, type FormEvent } from "react"
import {
  IconExternalLink,
  IconFileText,
  IconPencil,
  IconPlus,
} from "@tabler/icons-react"
import { toast } from "sonner"

import {
  saveEstimateTextTemplateLibraryItem,
  type EstimateTextTemplateLibraryItem,
} from "@/app/actions/estimate-text-templates"
import { Badge } from "@/components/ui/badge"
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import type { EstimateTextTemplateType } from "@/lib/estimates/client-report"
import type { ProjectDepartment } from "@/lib/project-branding"

const DEPARTMENTS: readonly {
  readonly value: ProjectDepartment | "all"
  readonly label: string
}[] = [
  { value: "all", label: "All departments" },
  { value: "O", label: "O" },
  { value: "H", label: "H" },
  { value: "N", label: "N" },
  { value: "D", label: "D" },
]

const TEMPLATE_TYPES: readonly {
  readonly value: EstimateTextTemplateType
  readonly label: string
}[] = [
  { value: "terms", label: "Terms and conditions" },
  { value: "introduction", label: "Introduction" },
  { value: "closing", label: "Closing text" },
  { value: "acknowledgement", label: "Acknowledgement" },
]

function typeLabel(value: EstimateTextTemplateType): string {
  return TEMPLATE_TYPES.find((item) => item.value === value)?.label ?? value
}

function departmentLabel(value: ProjectDepartment | null): string {
  return value ?? "All departments"
}

function TemplateEditorDialog({
  template,
  canManage,
}: {
  readonly template: EstimateTextTemplateLibraryItem | null
  readonly canManage: boolean
}): React.ReactElement {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const [name, setName] = useState(template?.name ?? "")
  const [departmentCode, setDepartmentCode] = useState<
    ProjectDepartment | "all"
  >(template?.departmentCode ?? "all")
  const [templateType, setTemplateType] = useState<EstimateTextTemplateType>(
    template?.templateType ?? "terms"
  )
  const [body, setBody] = useState(template?.body ?? "")
  const identityLocked = template?.builtIn === true

  function reset(): void {
    setName(template?.name ?? "")
    setDepartmentCode(template?.departmentCode ?? "all")
    setTemplateType(template?.templateType ?? "terms")
    setBody(template?.body ?? "")
  }

  function save(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    startTransition(async () => {
      const result = await saveEstimateTextTemplateLibraryItem({
        templateId: template?.id ?? null,
        name,
        departmentCode,
        templateType,
        body,
      })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success(
        template
          ? "Estimate report text updated in Compass and Google Drive."
          : "Estimate report text added to Compass and Google Drive."
      )
      setOpen(false)
      router.refresh()
    })
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen)
        if (nextOpen) reset()
      }}
    >
      <DialogTrigger asChild>
        {template ? (
          <Button size="sm" variant="outline" disabled={!canManage}>
            <IconPencil className="mr-2 size-4" />
            Edit
          </Button>
        ) : (
          <Button disabled={!canManage}>
            <IconPlus className="mr-2 size-4" />
            Add report text
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <form onSubmit={save}>
          <DialogHeader>
            <DialogTitle>
              {template ? `Edit ${template.name}` : "Add estimate report text"}
            </DialogTitle>
            <DialogDescription>
              Saving updates the organization library and its text file in
              ________Developer / Compass / Template Library. Estimates retain
              the wording they already saved.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-5 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor={`text-template-name-${template?.id ?? "new"}`}>
                Template name
              </Label>
              <Input
                id={`text-template-name-${template?.id ?? "new"}`}
                value={name}
                onChange={(event) => setName(event.target.value)}
                disabled={identityLocked || pending}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label>Department</Label>
              <Select
                value={departmentCode}
                onValueChange={(value) => {
                  if (
                    value === "all" ||
                    value === "O" ||
                    value === "H" ||
                    value === "N" ||
                    value === "D"
                  ) {
                    setDepartmentCode(value)
                  }
                }}
                disabled={identityLocked || pending}
              >
                <SelectTrigger aria-label="Template department">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DEPARTMENTS.map((department) => (
                    <SelectItem key={department.value} value={department.value}>
                      {department.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Text type</Label>
              <Select
                value={templateType}
                onValueChange={(value) => {
                  if (
                    value === "terms" ||
                    value === "introduction" ||
                    value === "closing" ||
                    value === "acknowledgement"
                  ) {
                    setTemplateType(value)
                  }
                }}
                disabled={identityLocked || pending}
              >
                <SelectTrigger aria-label="Template text type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TEMPLATE_TYPES.map((type) => (
                    <SelectItem key={type.value} value={type.value}>
                      {type.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor={`text-template-body-${template?.id ?? "new"}`}>
                Template text
              </Label>
              <Textarea
                id={`text-template-body-${template?.id ?? "new"}`}
                value={body}
                onChange={(event) => setBody(event.target.value)}
                rows={14}
                disabled={pending}
                required
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save report text"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function EstimateTextTemplateLibrary({
  templates,
  canManage,
}: {
  readonly templates: readonly EstimateTextTemplateLibraryItem[]
  readonly canManage: boolean
}): React.ReactElement {
  return (
    <section>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 font-semibold">
            <IconFileText className="size-5 text-primary" />
            Estimate report text
          </div>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Reusable introductions, closing text, terms, and acknowledgements.
            New and edited templates are saved by default in Google Drive under
            ________Developer / Compass / Template Library.
          </p>
        </div>
        <TemplateEditorDialog template={null} canManage={canManage} />
      </div>

      {templates.length === 0 ? (
        <div className="mt-5 border-y py-10 text-sm text-muted-foreground">
          No estimate report text is available.
        </div>
      ) : (
        <div className="mt-5 divide-y border-y">
          {templates.map((template) => (
            <article
              key={template.id}
              className="grid gap-4 py-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-medium">{template.name}</h3>
                  <Badge variant="outline">
                    {departmentLabel(template.departmentCode)}
                  </Badge>
                  <Badge variant="secondary">
                    {typeLabel(template.templateType)}
                  </Badge>
                  {template.builtIn && <Badge>Built-in default</Badge>}
                </div>
                <p className="mt-2 line-clamp-3 whitespace-pre-line text-sm text-muted-foreground">
                  {template.body}
                </p>
              </div>
              <div className="flex items-center justify-end gap-1">
                {template.sourceUrl && (
                  <Button asChild size="sm" variant="ghost">
                    <Link href={template.sourceUrl} target="_blank">
                      Drive <IconExternalLink className="ml-1 size-3.5" />
                    </Link>
                  </Button>
                )}
                <TemplateEditorDialog template={template} canManage={canManage} />
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}
