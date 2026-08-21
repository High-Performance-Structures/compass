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
  publishCapturedProjectTemplate,
  updateProjectTemplateCategory,
  type ProjectTemplateLibraryItem,
} from "@/app/actions/project-templates"
import type { EstimateTextTemplateLibraryItem } from "@/app/actions/estimate-text-templates"
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
import { useDeveloperMode } from "@/components/developer-mode-provider"
import { Button } from "@/components/ui/button"
import { templateDetailHref } from "@/lib/templates/template-detail-route"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { EstimateTemplateCreateDialog } from "./estimate-template-create-dialog"
import { EstimateTextTemplateLibrary } from "./estimate-text-template-library"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

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
  readonly estimateTextTemplates: readonly EstimateTextTemplateLibraryItem[]
  readonly canManage: boolean
  readonly canCreateEstimate: boolean
  readonly canManageEstimateText: boolean
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

function CategoryControl({
  template,
}: {
  readonly template: ProjectTemplateLibraryItem
}): React.ReactElement {
  const [category, setCategory] = useState(template.tradeCategory ?? "Other")
  const [pending, startTransition] = useTransition()

  function save(nextCategory: string): void {
    startTransition(async () => {
      const result = await updateProjectTemplateCategory({
        templateId: template.id,
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
    <div>
      <Select
        disabled={pending}
        value={category}
        onValueChange={(value) => {
          setCategory(value)
          save(value)
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

function PublishTemplateButton({
  template,
}: {
  readonly template: ProjectTemplateLibraryItem
}): React.ReactElement {
  const [pending, startTransition] = useTransition()
  const warningCount = template.modules.filter(
    (module) => module.normalizationStatus === "captured_with_warnings"
  ).length
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button size="sm" variant="default">
          <IconCircleCheck className="mr-2 size-4" />
          Review and publish
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Publish “{template.name}”?</AlertDialogTitle>
          <AlertDialogDescription>
            Compass will verify every captured module count before publishing.
            {warningCount > 0
              ? ` ${warningCount} module${warningCount === 1 ? " has" : "s have"} documented conversion warnings; review the template details before continuing.`
              : " No conversion warnings were recorded."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Keep as draft</AlertDialogCancel>
          <AlertDialogAction
            disabled={pending}
            onClick={(event) => {
              event.preventDefault()
              startTransition(async () => {
                const result = await publishCapturedProjectTemplate({
                  templateId: template.id,
                })
                if (!result.success) {
                  toast.error(result.error)
                  return
                }
                toast.success("Template reviewed and published.")
              })
            }}
          >
            {pending ? "Publishing…" : "Publish template"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export function TemplateLibraryView({
  templates,
  estimateTextTemplates,
  canManage,
  canCreateEstimate,
  canManageEstimateText,
}: Props): React.ReactElement {
  const { developerModeEnabled } = useDeveloperMode()
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
      categoryFilter === "all" ||
      (template.tradeCategory ?? "Other") === categoryFilter
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
          {developerModeEnabled && (
            <span className="text-muted-foreground">{inventoryCount} awaiting content capture</span>
          )}
          <span className="text-muted-foreground">{readyCount} verified and usable</span>
          {developerModeEnabled && (
            <span className="font-medium text-amber-700 dark:text-amber-300">
              Archived Buildertrend templates excluded
            </span>
          )}
        </div>
      </header>

      <main className="flex-1 overflow-y-auto px-4 py-5 sm:px-6">
        <Tabs defaultValue="project-content">
          <TabsList>
            <TabsTrigger value="project-content">Project content</TabsTrigger>
            <TabsTrigger value="estimate-report-text">
              Estimate report text
            </TabsTrigger>
          </TabsList>
          <TabsContent value="project-content" className="mt-5">
            <div className="mb-5 border-y py-3 sm:max-w-sm">
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
                      <Link className="truncate font-medium hover:underline" href={templateDetailHref(template.id)}>
                        {template.name}
                      </Link>
                      <Badge variant="outline">
                        {template.templateKind === "project" ? "Project" : template.templateKind === "estimate" ? "Estimate" : "Assembly"}
                      </Badge>
                      <Badge variant="secondary">{template.tradeCategory ?? "Other"}</Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {template.scheduleItemCount} schedule items
                      {developerModeEnabled
                        ? ` · ${contentCount} stored source records${
                            template.currentVersionNumber
                              ? ` · version ${template.currentVersionNumber}`
                              : " · content capture pending"
                          }`
                        : ""}
                    </p>
                    <div className="mt-2 flex items-center gap-2 text-sm">
                      {ready ? <IconCircleCheck className="size-4 text-emerald-600" /> : <IconClockHour4 className="size-4 text-amber-600" />}
                      {developerModeEnabled
                        ? reviewLabel(template.reviewStatus)
                        : ready
                          ? "Ready"
                          : "Needs setup"}
                    </div>
                  </div>
                  {canManage ? (
                    <CategoryControl template={template} />
                  ) : (
                    <span className="text-sm text-muted-foreground">{template.tradeCategory ?? "Other"}</span>
                  )}
                  <div className="flex justify-end gap-1">
                    {developerModeEnabled && canManage &&
                      template.reviewStatus === "content_captured" &&
                      template.currentVersionStatus === "draft" && (
                        <PublishTemplateButton template={template} />
                      )}
                    <Button asChild size="sm" variant="outline">
                      <Link href={templateDetailHref(template.id)}>Open</Link>
                    </Button>
                    {canManage && <DeleteTemplateButton template={template} />}
                  </div>
                    </article>
                  )
                })}
              </div>
            )}
          </TabsContent>
          <TabsContent value="estimate-report-text" className="mt-5">
            <EstimateTextTemplateLibrary
              templates={estimateTextTemplates}
              canManage={canManageEstimateText}
            />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  )
}
