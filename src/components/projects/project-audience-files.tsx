"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { IconDownload, IconFile, IconUpload } from "@tabler/icons-react"

import { Button } from "@/components/ui/button"
import { formatFileSize } from "@/lib/file-utils"
import {
  EXTERNAL_PROJECT_FILE_ACCEPT,
  MAX_EXTERNAL_PROJECT_FILES_PER_UPLOAD,
  MAX_EXTERNAL_PROJECT_FILE_BYTES,
  MAX_EXTERNAL_PROJECT_FILE_ROLLING_BYTES,
} from "@/lib/project-audience-file-policy"
import type { ProjectAudience } from "@/lib/project-audience-access"

type AudienceFile = {
  readonly id: string
  readonly fileName: string
  readonly mimeType: string
  readonly fileSize: number
  readonly createdAt: string
  readonly uploadedAt: string | null
  readonly downloadUrl: string
}

function isAudienceFile(value: unknown): value is AudienceFile {
  if (
    typeof value !== "object" ||
    value === null ||
    !("id" in value) ||
    !("fileName" in value) ||
    !("mimeType" in value) ||
    !("fileSize" in value) ||
    !("createdAt" in value) ||
    !("downloadUrl" in value)
  ) {
    return false
  }
  return (
    typeof value.id === "string" &&
    typeof value.fileName === "string" &&
    typeof value.mimeType === "string" &&
    typeof value.fileSize === "number" &&
    typeof value.createdAt === "string" &&
    typeof value.downloadUrl === "string"
  )
}

function audiencePath(audience: ProjectAudience): string {
  return audience === "owner" ? "owner" : "sub-vendor"
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

export function ProjectAudienceFiles({
  projectId,
  audience,
  canUpload,
}: {
  readonly projectId: string
  readonly audience: ProjectAudience
  readonly canUpload: boolean
}) {
  const [files, setFiles] = useState<readonly AudienceFile[]>([])
  const [selectedFiles, setSelectedFiles] = useState<readonly File[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const endpoint =
    `/api/projects/${encodeURIComponent(projectId)}/audience-files/` +
    audiencePath(audience)

  const loadFiles = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch(endpoint, { cache: "no-store" })
      const body: unknown = await response.json()
      if (
        !response.ok ||
        typeof body !== "object" ||
        body === null ||
        !("files" in body) ||
        !Array.isArray(body.files) ||
        !body.files.every(isAudienceFile)
      ) {
        throw new Error("Unable to load project files.")
      }
      setFiles(body.files)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load project files.")
    } finally {
      setLoading(false)
    }
  }, [endpoint])

  useEffect(() => {
    void loadFiles()
  }, [loadFiles])

  const upload = useCallback(async () => {
    if (selectedFiles.length === 0) return
    setUploading(true)
    setError(null)
    try {
      const formData = new FormData()
      for (const file of selectedFiles) formData.append("files", file)
      const response = await fetch(endpoint, { method: "POST", body: formData })
      const body: unknown = await response.json()
      if (!response.ok) {
        const message =
          typeof body === "object" && body !== null && "error" in body && typeof body.error === "string"
            ? body.error
            : "Unable to upload project files."
        throw new Error(message)
      }
      setSelectedFiles([])
      if (inputRef.current) inputRef.current.value = ""
      await loadFiles()
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Unable to upload project files.")
    } finally {
      setUploading(false)
    }
  }, [endpoint, loadFiles, selectedFiles])

  const folderLabel = audience === "owner" ? "Owner Uploads" : "Sub-Supplier Uploads"

  return (
    <main className="min-h-screen bg-muted/20 px-4 py-5 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl">
        <header className="border-b pb-5">
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
            Project workspace / files
          </p>
          <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <IconFile className="size-5 text-primary" />
                <h1 className="text-2xl font-semibold tracking-tight">Project files</h1>
              </div>
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                {canUpload
                  ? `Share design ideas, specifications, and other project reference files in ${folderLabel}.`
                  : `Review the files shared in ${folderLabel}.`}
              </p>
            </div>
            <p className="font-mono text-xs text-muted-foreground">{folderLabel}</p>
          </div>
        </header>

        <section className="grid border-x border-b bg-background sm:grid-cols-3">
          <div className="border-b p-4 sm:border-b-0 sm:border-r">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Folder</p>
            <p className="mt-1 text-sm font-semibold">{folderLabel}</p>
          </div>
          <div className="border-b p-4 sm:border-b-0 sm:border-r">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Upload allowance</p>
            <p className="mt-1 text-sm font-semibold">{formatFileSize(MAX_EXTERNAL_PROJECT_FILE_ROLLING_BYTES)} / 30 days</p>
          </div>
          <div className="p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Available files</p>
            <p className="mt-1 text-sm font-semibold">{loading ? "Loading" : files.length}</p>
          </div>
        </section>

        {canUpload && (
          <section className="border-x border-b bg-background p-4 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className="text-sm font-semibold">Add files</h2>
                <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                  Photos and PDFs only. Up to {MAX_EXTERNAL_PROJECT_FILES_PER_UPLOAD} files at a time and {formatFileSize(MAX_EXTERNAL_PROJECT_FILE_BYTES)} each.
                </p>
              </div>
              <Button
                disabled={selectedFiles.length === 0 || uploading}
                onClick={() => void upload()}
              >
                <IconUpload className="mr-2 size-4" />
                {uploading ? "Uploading…" : "Upload files"}
              </Button>
            </div>
            <input
              ref={inputRef}
              className="mt-4 block w-full border-t pt-4 text-sm"
              type="file"
              accept={EXTERNAL_PROJECT_FILE_ACCEPT}
              multiple
              onChange={(event) => setSelectedFiles(Array.from(event.target.files ?? []))}
            />
            {selectedFiles.length > 0 && (
              <p className="mt-3 font-mono text-xs text-muted-foreground">
                {selectedFiles.length} file{selectedFiles.length === 1 ? "" : "s"} selected · {formatFileSize(selectedFiles.reduce((total, file) => total + file.size, 0))}
              </p>
            )}
          </section>
        )}

        {error && (
          <p role="alert" className="border-x border-b border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </p>
        )}

        <section className="border-x border-b bg-background">
          <div className="flex items-center justify-between border-b px-4 py-3 sm:px-5">
            <h2 className="text-sm font-semibold">{folderLabel}</h2>
            <span className="font-mono text-xs text-muted-foreground">{files.length} items</span>
          </div>
          {loading ? (
            <p className="p-5 text-sm text-muted-foreground">Loading files…</p>
          ) : files.length === 0 ? (
            <p className="p-5 text-sm text-muted-foreground">No files have been shared here yet.</p>
          ) : (
            <ul className="divide-y">
              {files.map((file) => (
                <li key={file.id} className="flex items-center justify-between gap-3 px-4 py-3 sm:px-5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{file.fileName}</p>
                    <p className="mt-1 font-mono text-xs text-muted-foreground">
                      {formatFileSize(file.fileSize)} · {formatDate(file.uploadedAt ?? file.createdAt)}
                    </p>
                  </div>
                  <Button asChild size="sm" variant="outline">
                    <a href={file.downloadUrl}>
                      <IconDownload className="mr-2 size-4" />
                      Download
                    </a>
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  )
}
