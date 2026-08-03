"use client"

import Link from "next/link"
import { useMemo, useState, useTransition } from "react"
import {
  IconArrowLeft,
  IconCircleCheck,
  IconClockHour4,
  IconTemplate,
  IconTrash,
} from "@tabler/icons-react"
import { toast } from "sonner"

import {
  deleteProjectTemplate,
  updateProjectTemplateClassification,
  type ProjectTemplateLibraryItem,
} from "@/app/actions/project-templates"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { EstimateTemplateCreateDialog } from "./estimate-template-create-dialog"

export const TEMPLATE_DEPARTMENTS = ["ORC", "HPS", "Nu-Tech", "Design"] as const
export const TEMPLATE_CATEGORIES = [
  "Concrete",
  "Preconstruction",
  "Drywall",
  "Earthwork",
  "Exterior Finishes",
  "Framing",
  "Insulation",
  "Interior Finishes",
  "MEP",
  "General",
  "Other",
] as const

type Props = {
  readonly templates: readonly ProjectTemplateLibraryItem[]
  readonly canManage: boolean
  readonly canCreateEstimate: boolean
}

function reviewLabel(reviewStatus: string): string {
  switch (reviewStatus) {
    case "verified":
      return "Verified"
    case "content_captured":
      return "Content captured"
    default:
      return "Inventory only"
  }
}

function normalizedDepartment(value: string | null): string {
  if (value === "D") return "Design"
  if (value === "N") return "Nu-Tech"
  if (value === "O") return "ORC"
  if (value === "H") return "HPS"
  return value ?? "ORC"
}

function ClassificationControls({
  template,
}: {
  readonly template: ProjectTemplateLibraryItem
}): React.ReactElement {
  const [department, setDepartment] = useState(
    normalizedDepartment(template.departmentCode)
  )
  const [category, setCategory] = useState(template.tradeCategory ?? "Other")
  const [pending, startTransition] = useTransition()

  function save(nextDepartment: string, nextCategory: string): void {
    startTransition(async () => {
      const result = await updateProjectTemplateClassification({
        templateId: template.id,
        department: nextDepartment,
        category: nextCategory,
      })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success("Template classification updated.")
    })
  }

  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <Select
        disabled={pending}
        value={department}
        onValueChange={(value) => {
          setDepartment(value)
          save(value, category)
        }}
      >
        <SelectTrigger aria-label={`Department for ${template.name}`}>
          <SelectValue placeholder="Department" />
        </SelectTrigger>
        <SelectContent>
          {TEMPLATE_DEPARTMENTS.map((option) => (
            <SelectItem key={option} value={option}>
              {option}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        disabled={pending}
        value={category}
        onValueChange={(value) => {
          setCategory(value)
          save(department, value)
        }}
      >
        <SelectTrigger aria-label={`Category for ${template.name}`}>
          <SelectValue placeholder="Category" />
        </SelectTrigger>
        <SelectContent>
          {TEMPLATE_CATEGORIES.map((option) => (
            <SelectItem key={option} value={option}>
              {option}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

function DeleteTemplateButton({
  template,
}: {
  readonly template: ProjectTemplateLibraryItem
}): React.ReactElement {
  const [pending, startTransition] = useTransition()
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button size="sm" variant="ghost">
          <IconTrash className="mr-2 size-4" />
          Delete
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete “{template.name}”?</AlertDialogTitle>
          <AlertDialogDescription>
            This removes the template and all of its locally stored content.
            Templates already applied to a project are retained for audit and
            cannot be deleted.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={pending}
            onClick={(event) => {
              event.preventDefault()
              startTransition(async () => {
                const result = await deleteProjectTemplate({
                  templateId: template.id,
                })
                if (!result.success) {
                  toast.error(result.error)
                  return
                }
                toast.success("Template deleted.")
              })
            }}
          >
            {pending ? "Deleting…" : "Delete template"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export function TemplateLibraryView({
  templates,
  canManage,
  canCreateEstimate,
}: Props): React.ReactElement {
  const [departmentFilter, setDepartmentFilter] = useState("all")
  const [categoryFilter, setCategoryFilter] = useState("all")
  const categories = useMemo(
    () =>
      [...new Set(templates.map((template) => template.tradeCategory ?? "Other"))].sort(
        (left, right) => left.localeCompare(right)
      ),
    [templates]
  )
  const filtered = templates.filter(
    (template) =>
      (departmentFilter === "all" ||
        normalizedDepartment(template.departmentCode) === departmentFilter) &&
      (categoryFilter === "all" ||
        (template.tradeCategory ?? "Other") === categoryFilter)
  )
  const readyCount = templates.filter(
    (template) =>
      template.lifecycleStatus === "active" && template.reviewStatus === "verified"
  ).length
  const inventoryCount = templates.filter(
    (template) => template.reviewStatus === "inventory_only"
  ).length

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <header className="shrink-0 border-b px-4 py-4 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="mb-1 flex items-center gap-2 text-sm text-muted-foreground">
              <IconTemplate className="size-4" />
              Project setup
            </div>
            <h1 className="text-2xl font-semibold tracking-tight">Template Library</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Reusable Compass content for project setup, schedules, tasks,
              selections, and bid packages.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {canCreateEstimate && <EstimateTemplateCreateDialog />}
            <Button asChild variant="outline">
              <Link href="/dashboard/schedule">
                <IconArrowLeft className="mr-2 size-4" />
                Back to schedules
              </Link>
            </Button>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 border-t pt-3 text-sm">
          <span>{templates.length} templates in Compass</span>
          <span className="text-muted-foreground">{inventoryCount} awaiting content capture</span>
          <span className="text-muted-foreground">{readyCount} verified and usable</span>
          <span className="font-medium text-amber-700 dark:text-amber-300">
            Archived Buildertrend templates excluded
          </span>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto px-4 py-5 sm:px-6">
        <div className="mb-5 grid gap-3 border-y py-3 sm:grid-cols-2 lg:max-w-2xl">
          <Select value={departmentFilter} onValueChange={setDepartmentFilter}>
            <SelectTrigger aria-label="Filter templates by department">
              <SelectValue placeholder="All departments" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All departments</SelectItem>
              {TEMPLATE_DEPARTMENTS.map((department) => (
                <SelectItem key={department} value={department}>{department}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger aria-label="Filter templates by category">
              <SelectValue placeholder="All categories" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              {categories.map((category) => (
                <SelectItem key={category} value={category}>{category}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {filtered.length === 0 ? (
          <div className="border-y py-10 text-sm text-muted-foreground">
            No templates match those filters.
          </div>
        ) : (
          <div className="divide-y border-y">
            {filtered.map((template) => {
              const ready =
                template.lifecycleStatus === "active" &&
                template.reviewStatus === "verified" &&
                template.currentVersionStatus === "published"
              const contentCount = template.modules.reduce(
                (total, module) => total + module.sourceItemCount,
                0
              )
              return (
                <article key={template.id} className="grid gap-4 py-4 xl:grid-cols-[minmax(0,1fr)_24rem_auto] xl:items-center">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link className="truncate font-medium hover:underline" href={`/dashboard/templates/${template.id}`}>
                        {template.name}
                      </Link>
                      <Badge variant="outline">
                        {template.templateKind === "project" ? "Project" : template.templateKind === "estimate" ? "Estimate" : "Assembly"}
                      </Badge>
                      <Badge variant="secondary">{normalizedDepartment(template.departmentCode)}</Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {template.scheduleItemCount} schedule items · {contentCount} stored source records
                      {template.currentVersionNumber ? ` · version ${template.currentVersionNumber}` : " · content capture pending"}
                    </p>
                    <div className="mt-2 flex items-center gap-2 text-sm">
                      {ready ? <IconCircleCheck className="size-4 text-emerald-600" /> : <IconClockHour4 className="size-4 text-amber-600" />}
                      {reviewLabel(template.reviewStatus)}
                    </div>
                  </div>
                  {canManage ? (
                    <ClassificationControls template={template} />
                  ) : (
                    <span className="text-sm text-muted-foreground">{template.tradeCategory ?? "Other"}</span>
                  )}
                  <div className="flex justify-end gap-1">
                    <Button asChild size="sm" variant="outline">
                      <Link href={`/dashboard/templates/${template.id}`}>Open</Link>
                    </Button>
                    {canManage && <DeleteTemplateButton template={template} />}
                  </div>
                </article>
              )
            })}
          </div>
        )}
      </main>
    </div>
  )
}
