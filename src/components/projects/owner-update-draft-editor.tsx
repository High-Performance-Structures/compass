"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import {
  IconCalendarCheck,
  IconCalendarStats,
  IconCheck,
  IconFile,
  IconPhoto,
  IconRefresh,
  IconRobot,
  IconUpload,
  IconX,
} from "@tabler/icons-react"

import {
  draftOwnerProjectUpdateWithJarvis,
  updateOwnerProjectUpdateDraft,
  type OwnerProjectUpdateDocument,
} from "@/app/actions/project-field"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  OwnerUpdateScheduleSelector,
  OwnerUpdateTodoSelector,
} from "@/components/projects/owner-update-item-selectors"
import type {
  OwnerUpdateScheduleSelection,
  OwnerUpdateTodoSelection,
} from "@/lib/owner-updates/snapshot"
import {
  MAX_PHOTO_UPLOAD_BATCH_BYTES,
  MAX_PHOTO_UPLOAD_FILE_BYTES,
  PHOTO_UPLOAD_LIMIT_LABEL,
} from "@/lib/photos/upload-limits"
import { resolvePhotoImageSource } from "@/lib/photo-sources"

type DraftStatus =
  | { readonly kind: "idle" }
  | { readonly kind: "saving"; readonly message: string }
  | { readonly kind: "saved"; readonly message: string }
  | { readonly kind: "error"; readonly message: string }

type UploadedFile = {
  readonly id: string
  readonly fileName: string
  readonly mimeType: string | null
}

function sourceLabel(value: string): string {
  if (value.toLowerCase().includes("buildertrend")) return "Buildertrend"
  if (value.toLowerCase().includes("compass")) return "Compass"
  return value
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

function uniqueIds(values: readonly string[]): readonly string[] {
  return [...new Set(values)]
}

function parseUploadedFiles(value: unknown): readonly UploadedFile[] {
  if (typeof value !== "object" || value === null || !("files" in value)) {
    return []
  }
  if (!Array.isArray(value.files)) return []

  return value.files.flatMap((file) => {
    if (
      typeof file !== "object" ||
      file === null ||
      !("id" in file) ||
      typeof file.id !== "string" ||
      !("fileName" in file) ||
      typeof file.fileName !== "string"
    ) {
      return []
    }
    const mimeType =
      "mimeType" in file && typeof file.mimeType === "string"
        ? file.mimeType
        : null
    return [{ id: file.id, fileName: file.fileName, mimeType }]
  })
}

function SelectionCount({
  selected,
  total,
}: {
  readonly selected: number
  readonly total: number
}): React.ReactElement {
  return (
    <span className="text-xs text-muted-foreground">
      {selected} selected · {total} available
    </span>
  )
}

export function OwnerUpdateDraftEditor({
  document,
}: {
  readonly document: OwnerProjectUpdateDocument
}): React.ReactElement {
  const router = useRouter()
  const [title, setTitle] = React.useState(document.update.title)
  const [updateDate, setUpdateDate] = React.useState(document.update.updateDate)
  const [periodStart, setPeriodStart] = React.useState(
    document.update.periodStart ?? document.update.updateDate
  )
  const [periodEnd, setPeriodEnd] = React.useState(
    document.update.periodEnd ?? document.update.updateDate
  )
  const [summary, setSummary] = React.useState(document.update.summary)
  const [sourceDailyLogIds, setSourceDailyLogIds] = React.useState<
    readonly string[]
  >(document.update.sourceDailyLogIds)
  const [selectedPhotoIds, setSelectedPhotoIds] = React.useState<
    readonly string[]
  >(document.update.selectedPhotoIds)
  const [selectedDocumentIds, setSelectedDocumentIds] = React.useState<
    readonly string[]
  >(document.update.selectedDocumentIds)
  const [completedScheduleItems, setCompletedScheduleItems] = React.useState<
    readonly OwnerUpdateScheduleSelection[]
  >(document.completedScheduleItems)
  const [lookAheadScheduleItems, setLookAheadScheduleItems] = React.useState<
    readonly OwnerUpdateScheduleSelection[]
  >(document.lookAheadScheduleItems)
  const [todos, setTodos] = React.useState<readonly OwnerUpdateTodoSelection[]>(
    document.todos
  )
  const [status, setStatus] = React.useState<DraftStatus>({ kind: "idle" })
  const [failedImageIds, setFailedImageIds] = React.useState<readonly string[]>(
    []
  )
  const [uploadFiles, setUploadFiles] = React.useState<readonly File[]>([])
  const [uploadCaption, setUploadCaption] = React.useState("")
  const [isUploading, setIsUploading] = React.useState(false)
  const selectedDailyLogIdSet = new Set(sourceDailyLogIds)
  const selectedPhotoIdSet = new Set(selectedPhotoIds)
  const selectedDocumentIdSet = new Set(selectedDocumentIds)
  const failedImageSet = new Set(failedImageIds)

  function toggleId(
    setter: React.Dispatch<React.SetStateAction<readonly string[]>>,
    id: string,
    checked: boolean
  ): void {
    setter((current) =>
      checked ? uniqueIds([...current, id]) : current.filter((value) => value !== id)
    )
  }

  function chooseUploadFiles(fileList: FileList | null): void {
    const files = fileList === null ? [] : Array.from(fileList)
    setUploadFiles(files)
    const oversized = files.find(
      (file) => file.size > MAX_PHOTO_UPLOAD_FILE_BYTES
    )
    const totalBytes = files.reduce((total, file) => total + file.size, 0)
    if (oversized) {
      setStatus({
        kind: "error",
        message: `${oversized.name} is too large. ${PHOTO_UPLOAD_LIMIT_LABEL}`,
      })
    } else if (totalBytes > MAX_PHOTO_UPLOAD_BATCH_BYTES) {
      setStatus({
        kind: "error",
        message: `${formatBytes(totalBytes)} selected. ${PHOTO_UPLOAD_LIMIT_LABEL}`,
      })
    } else {
      setStatus({ kind: "idle" })
    }
  }

  async function uploadOwnerUpdateFiles(): Promise<void> {
    if (uploadFiles.length === 0) return
    setIsUploading(true)
    setStatus({ kind: "saving", message: "Uploading files..." })

    try {
      const formData = new FormData()
      for (const file of uploadFiles) formData.append("files", file)
      formData.set("caption", uploadCaption)
      formData.set("capturedDate", periodEnd)
      formData.set("photoKind", "progress")
      formData.set("ownerVisible", "false")
      formData.set("subVendorVisible", "false")

      const response = await fetch(
        `/api/projects/${document.project.id}/photos/upload`,
        { method: "POST", body: formData }
      )
      const result: unknown = await response.json()
      if (
        !response.ok ||
        typeof result !== "object" ||
        result === null ||
        !("success" in result) ||
        result.success !== true
      ) {
        const message =
          typeof result === "object" &&
          result !== null &&
          "error" in result &&
          typeof result.error === "string"
            ? result.error
            : "Unable to upload the selected files."
        setStatus({ kind: "error", message })
        return
      }

      const uploaded = parseUploadedFiles(result)
      const photoIds = uploaded
        .filter((file) => file.mimeType?.startsWith("image/") === true)
        .map((file) => file.id)
      const documentIds = uploaded
        .filter((file) => file.mimeType?.startsWith("image/") !== true)
        .map((file) => file.id)
      setSelectedPhotoIds((current) => uniqueIds([...current, ...photoIds]))
      setSelectedDocumentIds((current) =>
        uniqueIds([...current, ...documentIds])
      )
      setUploadFiles([])
      setUploadCaption("")
      setStatus({
        kind: "saved",
        message: `${uploaded.length} file${uploaded.length === 1 ? "" : "s"} uploaded and selected.`,
      })
      router.refresh()
    } catch {
      setStatus({
        kind: "error",
        message: "Unable to upload the selected files.",
      })
    } finally {
      setIsUploading(false)
    }
  }

  async function saveDraft(): Promise<boolean> {
    setStatus({ kind: "saving", message: "Saving curated sources..." })
    try {
      const result = await updateOwnerProjectUpdateDraft(
        document.project.id,
        document.update.id,
        {
          title,
          updateDate,
          periodStart,
          periodEnd,
          summary,
          sourceDailyLogIds,
          selectedPhotoIds,
          selectedDocumentIds,
          completedScheduleItems,
          lookAheadScheduleItems,
          todos,
        }
      )

      if (!result.success) {
        setStatus({ kind: "error", message: result.error })
        return false
      }

      setStatus({
        kind: "saved",
        message: "Draft saved. Choices were refreshed for this period.",
      })
      router.refresh()
      return true
    } catch {
      setStatus({
        kind: "error",
        message: "Unable to save this draft. Please try again.",
      })
      return false
    }
  }

  async function draftWithJarvis(): Promise<void> {
    const saved = await saveDraft()
    if (!saved) return
    setStatus({ kind: "saving", message: "Jarvis is drafting the update..." })

    try {
      const result = await draftOwnerProjectUpdateWithJarvis(
        document.project.id,
        document.update.id
      )
      if (!result.success) {
        setStatus({ kind: "error", message: result.error })
        return
      }
      setSummary(result.summary)
      setStatus({
        kind: "saved",
        message: "Jarvis drafted the summary. Review and edit it before publishing.",
      })
      router.refresh()
    } catch {
      setStatus({
        kind: "error",
        message: "Jarvis could not draft this update. Your selections are saved.",
      })
    }
  }

  return (
    <section className="bg-background p-5 shadow-sm sm:p-6 print:hidden">
      <form
        onSubmit={(event) => {
          event.preventDefault()
          void saveDraft()
        }}
        className="space-y-6"
      >
        <div className="flex flex-wrap items-start justify-between gap-3 border-b pb-4">
          <div>
            <h2 className="text-base font-semibold">Create Owner Update</h2>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Choose the source material, ask Jarvis for a draft, then edit
              every owner-facing section before publishing.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => void draftWithJarvis()}
              disabled={status.kind === "saving"}
            >
              <IconRobot className="size-4" />
              Draft with Jarvis
            </Button>
            <Button type="submit" disabled={status.kind === "saving"}>
              {status.kind === "saved" ? (
                <IconCheck className="size-4" />
              ) : (
                <IconRefresh className="size-4" />
              )}
              Save draft
            </Button>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-[1fr_12rem]">
          <div className="space-y-2">
            <Label htmlFor="owner-update-title">Title</Label>
            <Input
              id="owner-update-title"
              value={title}
              onChange={(event) => setTitle(event.currentTarget.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="owner-update-date">Update date</Label>
            <Input
              id="owner-update-date"
              type="date"
              value={updateDate}
              onChange={(event) => setUpdateDate(event.currentTarget.value)}
              required
            />
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="owner-update-period-start">
              Reporting period starts
            </Label>
            <Input
              id="owner-update-period-start"
              type="date"
              value={periodStart}
              onChange={(event) => setPeriodStart(event.currentTarget.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="owner-update-period-end">
              Reporting period ends
            </Label>
            <Input
              id="owner-update-period-end"
              type="date"
              value={periodEnd}
              onChange={(event) => setPeriodEnd(event.currentTarget.value)}
              required
            />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Save after changing the dates to refresh the available logs, files,
          schedule items, and to-dos.
        </p>

        <section className="border-t pt-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold">Daily logs</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Selected hidden logs may inform Jarvis without exposing the full
                log to the owner.
              </p>
            </div>
            <SelectionCount
              selected={sourceDailyLogIds.length}
              total={document.availableDailyLogs.length}
            />
          </div>
          {document.availableDailyLogs.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">
              No daily logs fall within this reporting period.
            </p>
          ) : (
            <div className="mt-3 divide-y border-y">
              {document.availableDailyLogs.map((log) => (
                <label
                  key={log.id}
                  className="flex cursor-pointer items-start gap-3 py-3"
                >
                  <Checkbox
                    checked={selectedDailyLogIdSet.has(log.id)}
                    onCheckedChange={(value) =>
                      toggleId(
                        setSourceDailyLogIds,
                        log.id,
                        value === true
                      )
                    }
                    aria-label={`Include daily log from ${log.logDate}`}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">{log.logDate}</span>
                      <Badge variant="outline">
                        {sourceLabel(log.sourceSystem)}
                      </Badge>
                      {!log.isClientVisible && (
                        <Badge variant="secondary">Staff-only log</Badge>
                      )}
                    </span>
                    <span className="mt-1 line-clamp-2 block text-sm text-muted-foreground">
                      {log.workCompleted}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          )}
        </section>

        <section className="border-t pt-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <IconPhoto className="size-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold">
                Compass and Buildertrend photos
              </h3>
            </div>
            <SelectionCount
              selected={selectedPhotoIds.length}
              total={document.availablePhotos.length}
            />
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Selecting a photo shares that photo when this update is published;
            it does not make its whole daily log visible.
          </p>
          {document.availablePhotos.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">
              No photos are available for the selected period.
            </p>
          ) : (
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {document.availablePhotos.map((photo) => {
                const checked = selectedPhotoIdSet.has(photo.id)
                const resolvedImage = resolvePhotoImageSource(photo)
                const src = failedImageSet.has(photo.id)
                  ? null
                  : resolvedImage.src
                return (
                  <label
                    key={photo.id}
                    className="group relative cursor-pointer overflow-hidden border bg-muted/20"
                  >
                    <div className="absolute left-2 top-2 z-10 bg-background/90 p-1 shadow-sm">
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(value) =>
                          toggleId(
                            setSelectedPhotoIds,
                            photo.id,
                            value === true
                          )
                        }
                        aria-label={`Select ${photo.fileName}`}
                      />
                    </div>
                    {src ? (
                      <img
                        src={src}
                        alt={photo.caption ?? photo.fileName}
                        className="aspect-[4/3] w-full object-cover"
                        onError={() =>
                          setFailedImageIds((current) =>
                            uniqueIds([...current, photo.id])
                          )
                        }
                      />
                    ) : (
                      <div className="flex aspect-[4/3] items-center justify-center p-3 text-xs text-muted-foreground">
                        {resolvedImage.label}
                      </div>
                    )}
                    <div className="border-t bg-background px-2 py-2">
                      <p className="truncate text-xs font-medium">
                        {photo.caption ?? photo.fileName}
                      </p>
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        {sourceLabel(photo.sourceSystem)}
                      </p>
                    </div>
                  </label>
                )
              })}
            </div>
          )}
        </section>

        <section className="border-t pt-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <IconFile className="size-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold">Documents</h3>
            </div>
            <SelectionCount
              selected={selectedDocumentIds.length}
              total={document.availableDocuments.length}
            />
          </div>
          {document.availableDocuments.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">
              No documents are available for this period.
            </p>
          ) : (
            <div className="mt-3 divide-y border-y">
              {document.availableDocuments.map((file) => (
                <label
                  key={file.id}
                  className="flex cursor-pointer items-center gap-3 py-3"
                >
                  <Checkbox
                    checked={selectedDocumentIdSet.has(file.id)}
                    onCheckedChange={(value) =>
                      toggleId(
                        setSelectedDocumentIds,
                        file.id,
                        value === true
                      )
                    }
                    aria-label={`Include ${file.fileName}`}
                  />
                  <IconFile className="size-4 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      {file.caption ?? file.fileName}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {sourceLabel(file.sourceSystem)}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          )}

          <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
            <div className="space-y-2">
              <Label htmlFor={`owner-update-files-${document.update.id}`}>
                Upload photos or documents
              </Label>
              <Input
                id={`owner-update-files-${document.update.id}`}
                type="file"
                multiple
                accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt"
                onChange={(event) =>
                  chooseUploadFiles(event.currentTarget.files)
                }
              />
              <p className="text-xs text-muted-foreground">
                {PHOTO_UPLOAD_LIMIT_LABEL}
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor={`owner-update-caption-${document.update.id}`}>
                Caption / note
              </Label>
              <Input
                id={`owner-update-caption-${document.update.id}`}
                value={uploadCaption}
                onChange={(event) =>
                  setUploadCaption(event.currentTarget.value)
                }
                placeholder="Optional note for this batch"
              />
            </div>
            <div className="flex items-end">
              <Button
                type="button"
                variant="outline"
                onClick={() => void uploadOwnerUpdateFiles()}
                disabled={isUploading || uploadFiles.length === 0}
              >
                <IconUpload className="size-4" />
                {isUploading ? "Uploading..." : "Upload and select"}
              </Button>
            </div>
          </div>
          {uploadFiles.length > 0 && (
            <p className="mt-2 text-xs text-muted-foreground">
              {uploadFiles.length} selected ·{" "}
              {formatBytes(
                uploadFiles.reduce((total, file) => total + file.size, 0)
              )}
            </p>
          )}
        </section>

        <OwnerUpdateScheduleSelector
          title="Completed during this period"
          icon={
            <IconCalendarCheck className="size-4 text-muted-foreground" />
          }
          available={document.availableCompletedScheduleItems}
          selected={completedScheduleItems}
          setSelected={setCompletedScheduleItems}
        />
        <OwnerUpdateScheduleSelector
          title="Looking ahead"
          icon={
            <IconCalendarStats className="size-4 text-muted-foreground" />
          }
          available={document.availableLookAheadScheduleItems}
          selected={lookAheadScheduleItems}
          setSelected={setLookAheadScheduleItems}
        />
        <OwnerUpdateTodoSelector
          available={document.availableTodos}
          selected={todos}
          setSelected={setTodos}
        />

        <section className="border-t pt-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <Label htmlFor="owner-update-summary">Editable summary</Label>
              <p className="mt-1 text-xs text-muted-foreground">
                Jarvis writes only from the sources selected above. You remain
                in control of the final wording.
              </p>
            </div>
            {summary.length > 0 && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setSummary("")}
              >
                <IconX className="size-4" />
                Clear
              </Button>
            )}
          </div>
          <Textarea
            id="owner-update-summary"
            value={summary}
            onChange={(event) => setSummary(event.currentTarget.value)}
            className="mt-3 min-h-44"
            placeholder="Write the update manually or use Draft with Jarvis."
          />
        </section>

        {status.kind !== "idle" && (
          <p
            className={
              status.kind === "error"
                ? "border-l-2 border-l-destructive px-3 py-2 text-sm text-destructive"
                : "border-l-2 border-l-brand-hps-primary px-3 py-2 text-sm text-brand-hps-primary"
            }
          >
            {status.message}
          </p>
        )}
      </form>
    </section>
  )
}
