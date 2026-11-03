"use client"

import * as React from "react"
import { IconUpload } from "@tabler/icons-react"

import type { ProjectDailyLogItem } from "@/lib/domain/field/daily-log-workspace"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { SearchableCombobox } from "@/components/searchable-combobox"
import type { DailyLogUpload } from "@/components/projects/daily-log/use-daily-log-upload"
import { PHOTO_UPLOAD_LIMIT_LABEL } from "@/lib/photos/upload-limits"
import {
  formatBytes,
  NO_PHASE_VALUE,
  totalFileBytes,
} from "@/lib/daily-logs/workspace-view"

/** Add Photos or Documents to one saved log. */
export function DailyLogUploadPanel({
  log,
  upload,
  schedulePhases,
}: {
  readonly log: ProjectDailyLogItem
  readonly upload: DailyLogUpload
  readonly schedulePhases: readonly string[]
}): React.ReactElement {
  const { isUploading, uploadFiles } = upload
  return (
    <div className="mt-4 border-t pt-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">
            Add Photos or Documents
          </h3>
          <p className="text-xs text-muted-foreground">
            Files save to Google Drive and stay attached to this log.
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={upload.cancelUploadingFiles}
          disabled={isUploading}
        >
          Cancel
        </Button>
      </div>

      <div className="mt-3 grid min-w-0 gap-3 md:grid-cols-2 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)_minmax(0,0.7fr)_minmax(0,1fr)_auto]">
        <div className="grid gap-1.5">
          <Label htmlFor={`daily-log-files-${log.id}`}>
            Photos / documents
          </Label>
          <Input
            key={upload.uploadingLogId}
            id={`daily-log-files-${log.id}`}
            type="file"
            multiple
            accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt"
            onChange={(event) =>
              upload.chooseUploadFiles(event.currentTarget.files)
            }
          />
          <p className="text-xs text-muted-foreground">
            {PHOTO_UPLOAD_LIMIT_LABEL}
          </p>
          {uploadFiles.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {uploadFiles.length} selected ·{" "}
              {formatBytes(totalFileBytes(uploadFiles))}
            </p>
          )}
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={`daily-log-file-caption-${log.id}`}>
            Caption / note
          </Label>
          <Input
            id={`daily-log-file-caption-${log.id}`}
            value={upload.uploadCaption}
            onChange={(event) =>
              upload.setUploadCaption(event.currentTarget.value)
            }
            placeholder="Optional shared note for selected files"
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={`daily-log-file-phase-${log.id}`}>
            Phase for this batch
          </Label>
          <SearchableCombobox
            id={`daily-log-file-phase-${log.id}`}
            ariaLabel="Choose phase for attachment batch"
            options={[
              { value: NO_PHASE_VALUE, label: "No phase" },
              ...schedulePhases.map((phase) => ({
                value: phase,
                label: phase,
              })),
            ]}
            value={upload.uploadPhase}
            onValueChange={upload.setUploadPhase}
            placeholder="No phase"
            searchPlaceholder="Search phases..."
            emptyMessage="No matching phases."
            groupHeading="Phases"
          />
        </div>
        <fieldset className="min-w-0">
          <legend className="text-sm font-medium">
            Visibility for this batch
          </legend>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={upload.uploadOwnerVisible}
                onChange={(event) =>
                  upload.setUploadOwnerVisible(
                    event.currentTarget.checked
                  )
                }
                className="size-4 rounded border"
              />
              Owners
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={upload.uploadSubVendorVisible}
                onChange={(event) =>
                  upload.setUploadSubVendorVisible(
                    event.currentTarget.checked
                  )
                }
                className="size-4 rounded border"
              />
              Subcontractors
            </label>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Shared uploads are approved immediately. Leave both
            unchecked to keep them in staff review. Marking a file
            for Owners does not make the daily log owner-visible.
          </p>
        </fieldset>
        <div className="flex items-end">
          <Button
            type="button"
            onClick={() => {
              void upload.uploadDailyLogFiles(log)
            }}
            disabled={isUploading || uploadFiles.length === 0}
          >
            <IconUpload className="size-4" />
            {isUploading ? "Uploading..." : "Upload to Drive"}
          </Button>
        </div>
      </div>

      {upload.uploadMessage && (
        <p className="mt-3 rounded-md border bg-muted/30 px-3 py-2 text-sm">
          {upload.uploadMessage}
        </p>
      )}
    </div>
  )
}
