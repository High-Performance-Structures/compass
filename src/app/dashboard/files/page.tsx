"use client"

import { Suspense } from "react"
import { FileBrowser } from "@/components/files/file-browser"

export default function FilesPage() {
  return (
    <Suspense>
      <FileBrowser />
    </Suspense>
  )
}
