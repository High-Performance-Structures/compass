"use client"

import { Suspense } from "react"
import { useParams } from "next/navigation"
import { FileBrowser } from "@/components/files/file-browser"

export default function FilesFolderPage() {
  const params = useParams()
  const folderId = params.folderId as string

  return (
    <Suspense>
      <FileBrowser folderId={folderId} />
    </Suspense>
  )
}
