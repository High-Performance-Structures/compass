"use client"

import { useState, useCallback } from "react"
import { IconCloudUpload } from "@tabler/icons-react"
import { cn } from "@/lib/utils"

export function FileDropZone({
  children,
  onDrop,
}: {
  children: React.ReactNode
  onDrop: (files: File[]) => void
}) {
  const [dragging, setDragging] = useState(false)
  const [dragCounter, setDragCounter] = useState(0)

  const handleDragEnter = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setDragCounter(c => c + 1)
      if (e.dataTransfer.types.includes("Files")) {
        setDragging(true)
      }
    },
    []
  )

  const handleDragLeave = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setDragCounter(c => {
        const next = c - 1
        if (next <= 0) setDragging(false)
        return Math.max(0, next)
      })
    },
    []
  )

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
    },
    []
  )

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setDragging(false)
      setDragCounter(0)
      if (e.dataTransfer.files.length > 0) {
        onDrop(Array.from(e.dataTransfer.files))
      }
    },
    [onDrop]
  )

  return (
    <div
      className="relative flex-1"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {children}
      <div
        className={cn(
          "pointer-events-none absolute inset-0 z-50 flex items-center justify-center",
          "rounded-lg border-2 border-dashed transition-all duration-200",
          dragging
            ? "border-primary bg-primary/5 opacity-100"
            : "border-transparent opacity-0"
        )}
      >
        <div className="flex flex-col items-center gap-2 text-primary">
          <IconCloudUpload size={48} strokeWidth={1.5} />
          <p className="text-sm font-medium">
            Drop files to upload
          </p>
        </div>
      </div>
    </div>
  )
}
