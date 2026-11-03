"use client"

import * as React from "react"
import { IconUpload } from "@tabler/icons-react"

import type { ProjectPhotoLibrary } from "@/app/actions/project-photos"
import { Button } from "@/components/ui/button"
import { SearchableCombobox } from "@/components/searchable-combobox"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import type { PhotoUpload } from "@/components/projects/photo-review/use-photo-upload"
import { formatBytes, NO_PHASE_VALUE } from "@/lib/photos/review"

/** Upload Project Photos: images, caption, date, type and phase for the batch. */
export function PhotoUploadSheet({
  upload,
  phases,
}: {
  readonly upload: PhotoUpload
  readonly phases: ProjectPhotoLibrary["phases"]
}): React.ReactElement {
  const { uploadFiles, uploading } = upload
  return (
    <Sheet open={upload.uploadOpen} onOpenChange={upload.setUploadOpen}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>Upload Project Photos</SheetTitle>
          <SheetDescription>
            Saves originals to the project photo folder.
          </SheetDescription>
        </SheetHeader>
        <div className="space-y-4 px-4">
          <label className="block space-y-2 text-sm">
            <span className="text-xs font-medium uppercase text-muted-foreground">
              Images
            </span>
            <input
              type="file"
              accept="image/*"
              multiple
              onChange={(event) =>
                upload.setUploadFiles(
                  Array.from(event.currentTarget.files ?? [])
                )
              }
              className="block w-full rounded-md border bg-background px-3 py-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-1.5 file:text-sm file:font-medium"
            />
          </label>

          {uploadFiles.length > 0 && (
            <div className="rounded-md border bg-muted/20 p-3 text-xs text-muted-foreground">
              <p className="font-medium text-foreground">
                {uploadFiles.length} selected ·{" "}
                {formatBytes(
                  uploadFiles.reduce((sum, file) => sum + file.size, 0)
                )}
              </p>
              <ul className="mt-2 space-y-1">
                {uploadFiles.slice(0, 5).map((file) => (
                  <li key={`${file.name}-${file.size}`} className="truncate">
                    {file.name}
                  </li>
                ))}
              </ul>
              {uploadFiles.length > 5 && (
                <p className="mt-1">+{uploadFiles.length - 5} more</p>
              )}
            </div>
          )}

          <label className="block space-y-2 text-sm">
            <span className="text-xs font-medium uppercase text-muted-foreground">
              Caption or note
            </span>
            <textarea
              value={upload.uploadCaption}
              onChange={(event) => upload.setUploadCaption(event.target.value)}
              rows={3}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              placeholder="Optional note for this batch"
            />
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block space-y-2 text-sm">
              <span className="text-xs font-medium uppercase text-muted-foreground">
                Photo date
              </span>
              <input
                type="date"
                value={upload.uploadCapturedDate}
                onChange={(event) =>
                  upload.setUploadCapturedDate(event.target.value)
                }
                className="h-9 w-full rounded-md border bg-background px-3 text-sm"
              />
            </label>
            <label className="block space-y-2 text-sm">
              <span className="text-xs font-medium uppercase text-muted-foreground">
                Photo type
              </span>
              <Select
                value={upload.uploadPhotoKind}
                onValueChange={upload.setUploadPhotoKind}
              >
                <SelectTrigger aria-label="Upload photo type" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="progress">Progress</SelectItem>
                  <SelectItem value="issue">Issue</SelectItem>
                  <SelectItem value="delivery">Delivery</SelectItem>
                  <SelectItem value="selection">Selection</SelectItem>
                  <SelectItem value="archive">Archive</SelectItem>
                </SelectContent>
              </Select>
            </label>
          </div>

          <label className="block space-y-2 text-sm">
            <span className="text-xs font-medium uppercase text-muted-foreground">
              Phase
            </span>
            <SearchableCombobox
              ariaLabel="Upload phase"
              options={[
                { value: NO_PHASE_VALUE, label: "No phase" },
                ...phases.map((phase) => ({
                  value: phase.value,
                  label: phase.label,
                })),
              ]}
              value={upload.uploadPhase}
              onValueChange={upload.setUploadPhase}
              placeholder="No phase"
              searchPlaceholder="Search phases..."
              emptyMessage="No matching phases."
              groupHeading="Phases"
            />
          </label>

          <div className="rounded-md border bg-muted/20 p-3 text-xs text-muted-foreground">
            Uploads start internal-only.
          </div>

          {upload.uploadMessage && (
            <p className="text-sm text-muted-foreground">{upload.uploadMessage}</p>
          )}
        </div>
        <SheetFooter>
          <Button
            type="button"
            onClick={upload.uploadSelectedPhotos}
            disabled={uploading || uploadFiles.length === 0}
          >
            <IconUpload className="size-4" />
            {uploading ? "Uploading..." : "Upload to Drive"}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => upload.setUploadOpen(false)}
            disabled={uploading}
          >
            Cancel
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
