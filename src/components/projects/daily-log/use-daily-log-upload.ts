"use client"

import * as React from "react"

import type { ProjectDailyLogItem } from "@/lib/domain/field/daily-log-workspace"
import { PHOTO_UPLOAD_LIMIT_LABEL } from "@/lib/photos/upload-limits"
import {
  NO_PHASE_VALUE,
  parseUploadResponse,
  uploadBatchSummary,
  uploadFailureMessage,
  uploadSizeProblem,
  uploadSucceeded,
} from "@/lib/daily-logs/workspace-view"

type FileUploadResult =
  | { readonly success: true }
  | { readonly success: false; readonly error: string }

export type DailyLogUpload = {
  readonly uploadingLogId: string | null
  readonly setUploadingLogId: (logId: string | null) => void
  readonly uploadFiles: readonly File[]
  readonly uploadCaption: string
  readonly setUploadCaption: (value: string) => void
  readonly uploadPhase: string
  readonly setUploadPhase: (value: string) => void
  readonly uploadOwnerVisible: boolean
  readonly setUploadOwnerVisible: (value: boolean) => void
  readonly uploadSubVendorVisible: boolean
  readonly setUploadSubVendorVisible: (value: boolean) => void
  readonly uploadMessage: string | null
  readonly isUploading: boolean
  readonly startUploadingFiles: (log: ProjectDailyLogItem) => void
  readonly cancelUploadingFiles: () => void
  readonly chooseUploadFiles: (fileList: FileList | null) => void
  readonly uploadDailyLogFiles: (log: ProjectDailyLogItem) => Promise<void>
}

/** The Add files panel's state and the one-file-per-request Drive upload. */
export function useDailyLogUpload({
  projectId,
  setMessage,
  refresh,
}: {
  readonly projectId: string
  readonly setMessage: (message: string | null) => void
  readonly refresh: () => void
}): DailyLogUpload {
  const [uploadingLogId, setUploadingLogId] = React.useState<string | null>(null)
  const [uploadFiles, setUploadFiles] = React.useState<readonly File[]>([])
  const [uploadCaption, setUploadCaption] = React.useState("")
  const [uploadPhase, setUploadPhase] = React.useState(NO_PHASE_VALUE)
  const [uploadOwnerVisible, setUploadOwnerVisible] = React.useState(false)
  const [uploadSubVendorVisible, setUploadSubVendorVisible] =
    React.useState(false)
  const [uploadMessage, setUploadMessage] = React.useState<string | null>(null)
  const [isUploading, setUploading] = React.useState(false)

  function resetBatchFields(): void {
    setUploadFiles([])
    setUploadCaption("")
    setUploadPhase(NO_PHASE_VALUE)
    setUploadOwnerVisible(false)
    setUploadSubVendorVisible(false)
  }

  function startUploadingFiles(log: ProjectDailyLogItem): void {
    setMessage(null)
    setUploadMessage(null)
    setUploadingLogId(log.id)
    resetBatchFields()
  }

  function cancelUploadingFiles(): void {
    setUploadingLogId(null)
    resetBatchFields()
    setUploadMessage(null)
  }

  function chooseUploadFiles(fileList: FileList | null): void {
    const files = fileList === null ? [] : Array.from(fileList)
    setUploadFiles(files)
    setUploadMessage(uploadSizeProblem(files))
  }

  async function uploadDailyLogFile(
    log: ProjectDailyLogItem,
    file: File
  ): Promise<FileUploadResult> {
    const formData = new FormData()
    formData.append("files", file)
    formData.set("dailyLogId", log.id)
    formData.set("caption", uploadCaption)
    formData.set("capturedDate", log.logDate)
    formData.set("photoKind", "progress")
    formData.set("schedulePhase", uploadPhase)
    formData.set("ownerVisible", String(uploadOwnerVisible))
    formData.set("subVendorVisible", String(uploadSubVendorVisible))

    try {
      const response = await fetch(
        `/api/projects/${projectId}/photos/upload`,
        {
          method: "POST",
          body: formData,
        }
      )
      const responseText = await response.text()
      // A platform-level upload rejection can return a non-JSON response.
      const result = parseUploadResponse(responseText)

      if (uploadSucceeded(response.ok, result)) {
        return { success: true }
      }

      return {
        success: false,
        error: uploadFailureMessage(response.status, result, responseText),
      }
    } catch {
      return {
        success: false,
        error: "The upload connection was interrupted.",
      }
    }
  }

  async function uploadDailyLogFiles(log: ProjectDailyLogItem): Promise<void> {
    if (uploadFiles.length === 0) {
      setUploadMessage("Choose at least one photo or document.")
      return
    }

    const sizeProblem = uploadSizeProblem(uploadFiles)
    if (sizeProblem) {
      setUploadMessage(sizeProblem)
      return
    }

    setUploading(true)
    setUploadMessage(null)

    try {
      const failedFiles: File[] = []
      const failureMessages: string[] = []
      let uploadedCount = 0

      for (const [index, file] of uploadFiles.entries()) {
        setUploadMessage(
          `Uploading ${index + 1} of ${uploadFiles.length}: ${file.name}`
        )

        // Keep each request short so a mobile interruption cannot strand the
        // remainder of a multi-photo selection after the first Drive upload.
        const result = await uploadDailyLogFile(log, file)
        if (result.success) {
          uploadedCount += 1
        } else {
          failedFiles.push(file)
          failureMessages.push(`${file.name}: ${result.error}`)
        }
      }

      setUploadFiles(failedFiles)
      if (uploadedCount > 0) refresh()

      if (failedFiles.length === 0) {
        setUploadMessage(
          `Uploaded all ${uploadedCount} file${
            uploadedCount === 1 ? "" : "s"
          } to Google Drive.`
        )
        resetBatchFields()
        return
      }

      setUploadMessage(uploadBatchSummary(uploadedCount, uploadFiles.length, failureMessages))
    } catch {
      setUploadMessage(
        `Upload did not reach Compass. Check your connection and try fewer or smaller files. ${PHOTO_UPLOAD_LIMIT_LABEL}`
      )
    } finally {
      setUploading(false)
    }
  }

  return {
    uploadingLogId,
    setUploadingLogId,
    uploadFiles,
    uploadCaption,
    setUploadCaption,
    uploadPhase,
    setUploadPhase,
    uploadOwnerVisible,
    setUploadOwnerVisible,
    uploadSubVendorVisible,
    setUploadSubVendorVisible,
    uploadMessage,
    isUploading,
    startUploadingFiles,
    cancelUploadingFiles,
    chooseUploadFiles,
    uploadDailyLogFiles,
  }
}
