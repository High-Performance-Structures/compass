"use client"

import { Suspense } from "react"
import { useParams } from "next/navigation"
import { FileBrowser } from "@/components/files/file-browser"

export function FilesPageClient() {
  return (
    <Suspense>
      <FileBrowser />
    </Suspense>
  )
}

export function FilesPathPageClient() {
  const params = useParams<{ path: string[] }>()
  const path = params.path ?? []
  const decodedPath = path.map(decodeURIComponent)

  return (
    <Suspense>
      <FileBrowser path={decodedPath} />
    </Suspense>
  )
}

export function FilesFolderPageClient() {
  const params = useParams<{ folderId: string }>()
  const folderId = params.folderId

  return (
    <Suspense>
      <FileBrowser folderId={folderId} />
    </Suspense>
  )
}
