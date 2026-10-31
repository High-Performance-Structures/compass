"use client"

import * as React from "react"

import {
  currentDateInputValue,
  formatBytes,
  MAX_UPLOAD_FILE_BYTES,
  NO_PHASE_VALUE,
  photoUploadError,
  photoUploadSucceeded,
} from "@/lib/photos/review"

export type PhotoUpload = {
  readonly uploadOpen: boolean
  readonly setUploadOpen: (open: boolean) => void
  readonly uploadFiles: readonly File[]
  readonly setUploadFiles: (files: readonly File[]) => void
  readonly uploadCaption: string
  readonly setUploadCaption: (value: string) => void
  readonly uploadCapturedDate: string
  readonly setUploadCapturedDate: (value: string) => void
  readonly uploadPhotoKind: string
  readonly setUploadPhotoKind: (value: string) => void
  readonly uploadPhase: string
  readonly setUploadPhase: (value: string) => void
  readonly uploadMessage: string | null
  readonly uploading: boolean
  readonly openUploadSheet: () => void
  readonly uploadSelectedPhotos: () => Promise<void>
}

/** The Upload Project Photos sheet: its fields and the one-photo-per-request upload. */
export function usePhotoUpload({
  projectId,
  refresh,
}: {
  readonly projectId: string
  readonly refresh: () => void
}): PhotoUpload {
  const [uploadOpen, setUploadOpen] = React.useState(false)
  const [uploadFiles, setUploadFiles] = React.useState<readonly File[]>([])
  const [uploadCaption, setUploadCaption] = React.useState("")
  const [uploadCapturedDate, setUploadCapturedDate] = React.useState("")
  const [uploadPhotoKind, setUploadPhotoKind] = React.useState("progress")
  const [uploadPhase, setUploadPhase] = React.useState(NO_PHASE_VALUE)
  const [uploadMessage, setUploadMessage] = React.useState<string | null>(null)
  const [uploading, setUploading] = React.useState(false)

  function resetUploadForm(): void {
    setUploadFiles([])
    setUploadCaption("")
    setUploadCapturedDate(currentDateInputValue())
    setUploadPhotoKind("progress")
    setUploadPhase(NO_PHASE_VALUE)
  }

  function openUploadSheet(): void {
    if (uploadCapturedDate.length === 0) {
      setUploadCapturedDate(currentDateInputValue())
    }
    setUploadOpen(true)
  }

  async function uploadSelectedPhotos(): Promise<void> {
    if (uploadFiles.length === 0) {
      setUploadMessage("Choose at least one image to upload.")
      return
    }

    const oversizedFile = uploadFiles.find(
      (file) => file.size > MAX_UPLOAD_FILE_BYTES
    )
    if (oversizedFile) {
      setUploadMessage(
        `${oversizedFile.name} is ${formatBytes(oversizedFile.size)}. Upload photos under 50 MB each.`
      )
      return
    }

    const filesToUpload = uploadFiles

    setUploading(true)
    setUploadMessage(null)
    try {
      let uploadedCount = 0

      for (const [index, file] of filesToUpload.entries()) {
        setUploadMessage(
          `Uploading ${index + 1} of ${filesToUpload.length}: ${file.name}`
        )

        const formData = new FormData()
        formData.append("files", file)
        formData.set("caption", uploadCaption)
        formData.set("capturedDate", uploadCapturedDate)
        formData.set("photoKind", uploadPhotoKind)
        formData.set("schedulePhase", uploadPhase)

        const response = await fetch(
          `/api/projects/${projectId}/photos/upload`,
          {
            method: "POST",
            body: formData,
          }
        )
        const result: unknown = await response.json()

        if (photoUploadSucceeded(result)) {
          uploadedCount += 1
          continue
        }

        setUploadFiles(filesToUpload.slice(index))
        setUploadMessage(
          `Uploaded ${uploadedCount} of ${filesToUpload.length}. ${file.name}: ${photoUploadError(result)}`
        )
        refresh()
        return
      }

      setUploadMessage(
        `Uploaded ${uploadedCount} photo${uploadedCount === 1 ? "" : "s"} to Drive and queued for review.`
      )
      resetUploadForm()
      setUploadOpen(false)
      refresh()
    } catch {
      setUploadMessage("Unable to upload photos.")
    } finally {
      setUploading(false)
    }
  }

  return {
    uploadOpen,
    setUploadOpen,
    uploadFiles,
    setUploadFiles,
    uploadCaption,
    setUploadCaption,
    uploadCapturedDate,
    setUploadCapturedDate,
    uploadPhotoKind,
    setUploadPhotoKind,
    uploadPhase,
    setUploadPhase,
    uploadMessage,
    uploading,
    openUploadSheet,
    uploadSelectedPhotos,
  }
}
