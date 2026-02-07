"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { IconUpload, IconFile, IconCheck, IconX } from "@tabler/icons-react"

import { useFiles } from "@/hooks/use-files"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Progress } from "@/components/ui/progress"
import { Button } from "@/components/ui/button"
import { toast } from "sonner"
import { formatFileSize } from "@/lib/file-utils"

type UploadItem = {
  file: File
  progress: number
  status: "pending" | "uploading" | "done" | "error"
  error?: string
}

export function FileUploadDialog({
  open,
  onOpenChange,
  files: initialFiles,
  parentId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  files?: File[]
  parentId?: string | null
}) {
  const { getUploadUrl, state, fetchFiles } = useFiles()
  const [uploads, setUploads] = useState<UploadItem[]>([])
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) {
      setUploads([])
      setUploading(false)
      return
    }

    if (initialFiles && initialFiles.length > 0) {
      setUploads(
        initialFiles.map(f => ({
          file: f,
          progress: 0,
          status: "pending" as const,
        }))
      )
    }
  }, [open, initialFiles])

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const selected = e.target.files
      if (!selected) return
      const newUploads: UploadItem[] = Array.from(
        selected
      ).map(f => ({
        file: f,
        progress: 0,
        status: "pending" as const,
      }))
      setUploads(prev => [...prev, ...newUploads])
    },
    []
  )

  const uploadSingleFile = useCallback(
    async (item: UploadItem, index: number) => {
      setUploads(prev =>
        prev.map((u, i) =>
          i === index ? { ...u, status: "uploading" } : u
        )
      )

      try {
        if (state.isConnected !== true) {
          // mock mode: fake progress
          for (let p = 0; p <= 100; p += 20) {
            await new Promise(r => setTimeout(r, 100))
            setUploads(prev =>
              prev.map((u, i) =>
                i === index
                  ? { ...u, progress: Math.min(p, 100) }
                  : u
              )
            )
          }
          setUploads(prev =>
            prev.map((u, i) =>
              i === index
                ? { ...u, status: "done", progress: 100 }
                : u
            )
          )
          return
        }

        const uploadUrl = await getUploadUrl(
          item.file.name,
          item.file.type || "application/octet-stream",
          parentId ?? undefined
        )

        if (!uploadUrl) {
          throw new Error("Failed to get upload URL")
        }

        // upload directly to google using XHR for progress
        await new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest()
          xhr.open("PUT", uploadUrl)
          xhr.setRequestHeader(
            "Content-Type",
            item.file.type || "application/octet-stream"
          )

          xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) {
              const pct = Math.round(
                (e.loaded / e.total) * 100
              )
              setUploads(prev =>
                prev.map((u, i) =>
                  i === index
                    ? { ...u, progress: pct }
                    : u
                )
              )
            }
          }

          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              resolve()
            } else {
              reject(
                new Error(
                  `Upload failed: ${xhr.status}`
                )
              )
            }
          }

          xhr.onerror = () =>
            reject(new Error("Upload failed"))
          xhr.send(item.file)
        })

        setUploads(prev =>
          prev.map((u, i) =>
            i === index
              ? { ...u, status: "done", progress: 100 }
              : u
          )
        )
      } catch (err) {
        setUploads(prev =>
          prev.map((u, i) =>
            i === index
              ? {
                  ...u,
                  status: "error",
                  error:
                    err instanceof Error
                      ? err.message
                      : "Upload failed",
                }
              : u
          )
        )
      }
    },
    [getUploadUrl, parentId, state.isConnected]
  )

  const handleUpload = useCallback(async () => {
    if (uploads.length === 0) return
    setUploading(true)

    for (let i = 0; i < uploads.length; i++) {
      if (uploads[i].status === "pending") {
        await uploadSingleFile(uploads[i], i)
      }
    }

    setUploading(false)

    const allDone = uploads.every(
      u => u.status === "done" || u.status === "error"
    )
    if (allDone) {
      const successCount = uploads.filter(
        u => u.status === "done"
      ).length
      if (successCount > 0) {
        toast.success(
          `${successCount} file${successCount > 1 ? "s" : ""} uploaded`
        )
        // refresh file list
        if (state.isConnected === true) {
          await fetchFiles(parentId ?? undefined)
        }
      }
      setTimeout(() => onOpenChange(false), 500)
    }
  }, [
    uploads,
    uploadSingleFile,
    onOpenChange,
    state.isConnected,
    fetchFiles,
    parentId,
  ])

  const removeUpload = useCallback((index: number) => {
    setUploads(prev => prev.filter((_, i) => i !== index))
  }, [])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <IconUpload size={18} />
            Upload files
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 py-2">
          {uploads.length === 0 && (
            <div
              className="flex flex-col items-center gap-3 rounded-lg border-2 border-dashed p-8 cursor-pointer hover:border-primary/50"
              onClick={() => fileInputRef.current?.click()}
            >
              <IconUpload
                size={32}
                className="text-muted-foreground"
              />
              <p className="text-sm text-muted-foreground">
                Click to select files or drag and drop
              </p>
            </div>
          )}

          {uploads.map((item, i) => (
            <div key={i} className="space-y-1.5">
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2 min-w-0">
                  {item.status === "done" ? (
                    <IconCheck
                      size={14}
                      className="shrink-0 text-green-500"
                    />
                  ) : item.status === "error" ? (
                    <IconX
                      size={14}
                      className="shrink-0 text-destructive"
                    />
                  ) : (
                    <IconFile
                      size={14}
                      className="shrink-0 text-muted-foreground"
                    />
                  )}
                  <span className="truncate">
                    {item.file.name}
                  </span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-xs text-muted-foreground">
                    {formatFileSize(item.file.size)}
                  </span>
                  {item.status === "pending" &&
                    !uploading && (
                      <button
                        onClick={() => removeUpload(i)}
                        className="text-muted-foreground hover:text-foreground"
                      >
                        <IconX size={14} />
                      </button>
                    )}
                </div>
              </div>
              {(item.status === "uploading" ||
                item.status === "done") && (
                <Progress
                  value={item.progress}
                  className="h-1.5"
                />
              )}
              {item.error && (
                <p className="text-xs text-destructive">
                  {item.error}
                </p>
              )}
            </div>
          ))}
        </div>

        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={handleFileSelect}
        />

        <DialogFooter>
          {uploads.length > 0 && !uploading && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
            >
              Add more
            </Button>
          )}
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={uploading}
          >
            Cancel
          </Button>
          <Button
            onClick={handleUpload}
            disabled={
              uploads.length === 0 ||
              uploading ||
              uploads.every(u => u.status === "done")
            }
          >
            {uploading ? "Uploading..." : "Upload"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
