"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { IconFileImport, IconRefresh } from "@tabler/icons-react"

import {
  importProjectFinishSchedule,
  previewProjectFinishScheduleImport,
  type ProjectFinishScheduleImportPreview,
} from "@/app/actions/project-selections"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"

type ImportState =
  | { readonly kind: "idle" }
  | { readonly kind: "previewing" }
  | { readonly kind: "ready"; readonly preview: ProjectFinishScheduleImportPreview }
  | { readonly kind: "importing"; readonly preview: ProjectFinishScheduleImportPreview }
  | {
      readonly kind: "complete"
      readonly message: string
      readonly preview: ProjectFinishScheduleImportPreview
    }
  | { readonly kind: "error"; readonly message: string }

export function ProjectFinishScheduleImportSheet({
  projectId,
}: {
  readonly projectId: string
}): React.ReactElement {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [workbookUrl, setWorkbookUrl] = React.useState("")
  const [state, setState] = React.useState<ImportState>({ kind: "idle" })

  function changeWorkbookUrl(value: string): void {
    setWorkbookUrl(value)
    setState({ kind: "idle" })
  }

  async function preview(): Promise<void> {
    setState({ kind: "previewing" })
    const result = await previewProjectFinishScheduleImport(projectId, workbookUrl)
    if (!result.success) {
      setState({ kind: "error", message: result.error })
      return
    }
    setState({ kind: "ready", preview: result.preview })
  }

  async function applyImport(previewValue: ProjectFinishScheduleImportPreview): Promise<void> {
    setState({ kind: "importing", preview: previewValue })
    const result = await importProjectFinishSchedule(projectId, workbookUrl)
    if (!result.success) {
      setState({ kind: "error", message: result.error })
      return
    }
    const details = [
      `${result.createdCount} added`,
      `${result.updatedCount} refreshed`,
      result.removedCount > 0 ? `${result.removedCount} removed from source` : null,
      result.conflictCount > 0 ? `${result.conflictCount} preserved for review` : null,
      result.staleCount > 0 ? `${result.staleCount} stale source rows retained` : null,
    ].filter((value) => value !== null)
    setState({
      kind: "complete",
      message: details.join(" · "),
      preview: previewValue,
    })
    router.refresh()
  }

  const activePreview =
    state.kind === "ready" ||
    state.kind === "importing" ||
    state.kind === "complete"
      ? state.preview
      : null

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button type="button" variant="outline">
          <IconFileImport className="size-4" />
          Import workbook
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>Import finish schedule</SheetTitle>
          <SheetDescription>
            Preview a project workbook, verify its project number, then bring its
            room selections into Compass.
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-6 px-4 pb-6">
          <label className="block space-y-2">
            <span className="text-xs font-medium text-muted-foreground">
              Google Sheets workbook
            </span>
            <Input
              type="url"
              value={workbookUrl}
              placeholder="https://docs.google.com/spreadsheets/d/..."
              className="rounded-none border-x-0 border-t-0 px-0 shadow-none"
              onChange={(event) => changeWorkbookUrl(event.target.value)}
            />
          </label>

          <Button
            type="button"
            variant="outline"
            disabled={!workbookUrl.trim() || state.kind === "previewing" || state.kind === "importing"}
            onClick={preview}
          >
            {state.kind === "previewing" ? (
              <IconRefresh className="size-4 animate-spin" />
            ) : (
              <IconFileImport className="size-4" />
            )}
            Preview workbook
          </Button>

          {activePreview && (
            <section className="border-y py-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-semibold">{activePreview.workbookTitle}</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {activePreview.roomCount} rooms · {activePreview.selectionCount} selections
                  </p>
                </div>
                <Badge
                  variant={activePreview.projectMatch === "match" ? "secondary" : "destructive"}
                >
                  {activePreview.projectMatch === "match"
                    ? "Project verified"
                    : activePreview.projectMatch === "mismatch"
                      ? "Project mismatch"
                      : "Project unverified"}
                </Badge>
              </div>
              <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                <dt className="text-muted-foreground">Workbook</dt>
                <dd>{activePreview.workbookProjectNumber ?? "Not found"}</dd>
                <dt className="text-muted-foreground">Compass</dt>
                <dd>{activePreview.compassProjectNumber ?? "Not found"}</dd>
              </dl>
              {activePreview.warnings.length > 0 && (
                <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-amber-800 dark:text-amber-300">
                  {activePreview.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {state.kind === "error" && (
            <p className="text-sm text-destructive" role="alert">
              {state.message}
            </p>
          )}
          {state.kind === "complete" && (
            <p className="text-sm text-emerald-700 dark:text-emerald-300" role="status">
              Import complete: {state.message}
            </p>
          )}

          {activePreview && (
            <Button
              type="button"
              disabled={
                activePreview.projectMatch !== "match" ||
                activePreview.selectionCount === 0 ||
                state.kind === "importing"
              }
              onClick={() => applyImport(activePreview)}
            >
              {state.kind === "importing" ? (
                <IconRefresh className="size-4 animate-spin" />
              ) : (
                <IconFileImport className="size-4" />
              )}
              Import into Compass
            </Button>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
