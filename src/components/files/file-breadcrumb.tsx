"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import { IconChevronRight } from "@tabler/icons-react"

import { useFiles } from "@/hooks/use-files"
import { getDriveFileInfo } from "@/app/actions/google-drive"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"

type BreadcrumbSegment = {
  name: string
  folderId: string | null
}

export function FileBreadcrumb({
  path,
  folderId,
}: {
  path?: string[]
  folderId?: string
}) {
  const { state } = useFiles()
  const [segments, setSegments] = useState<
    BreadcrumbSegment[]
  >([])

  // for google drive mode: resolve folder ancestry
  useEffect(() => {
    if (state.isConnected !== true || !folderId) {
      setSegments([])
      return
    }

    let cancelled = false

    async function resolve() {
      const trail: BreadcrumbSegment[] = []
      let currentId: string | null = folderId ?? null

      // walk up the parents chain (max 10 deep to prevent infinite loops)
      for (let depth = 0; depth < 10 && currentId; depth++) {
        try {
          const result = await getDriveFileInfo(currentId)
          if (!result.success || cancelled) break
          trail.unshift({
            name: result.file.name,
            folderId: currentId,
          })
          currentId = result.file.parentId
        } catch {
          break
        }
      }

      if (!cancelled) {
        setSegments(trail)
      }
    }

    resolve()
    return () => {
      cancelled = true
    }
  }, [folderId, state.isConnected])

  // mock data mode: use path array
  if (state.isConnected !== true) {
    const effectivePath = path ?? []
    return (
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            {effectivePath.length === 0 ? (
              <BreadcrumbPage>My Files</BreadcrumbPage>
            ) : (
              <BreadcrumbLink asChild>
                <Link href="/dashboard/files">
                  My Files
                </Link>
              </BreadcrumbLink>
            )}
          </BreadcrumbItem>
          {effectivePath.map((segment, i) => {
            const isLast = i === effectivePath.length - 1
            const href = `/dashboard/files/${effectivePath.slice(0, i + 1).join("/")}`
            return (
              <span key={segment} className="contents">
                <BreadcrumbSeparator>
                  <IconChevronRight size={14} />
                </BreadcrumbSeparator>
                <BreadcrumbItem>
                  {isLast ? (
                    <BreadcrumbPage>
                      {segment}
                    </BreadcrumbPage>
                  ) : (
                    <BreadcrumbLink asChild>
                      <Link href={href}>{segment}</Link>
                    </BreadcrumbLink>
                  )}
                </BreadcrumbItem>
              </span>
            )
          })}
        </BreadcrumbList>
      </Breadcrumb>
    )
  }

  // google drive mode: use resolved segments
  return (
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem>
          {segments.length === 0 && !folderId ? (
            <BreadcrumbPage>My Files</BreadcrumbPage>
          ) : (
            <BreadcrumbLink asChild>
              <Link href="/dashboard/files">My Files</Link>
            </BreadcrumbLink>
          )}
        </BreadcrumbItem>
        {segments.map((seg, i) => {
          const isLast = i === segments.length - 1
          return (
            <span
              key={seg.folderId ?? i}
              className="contents"
            >
              <BreadcrumbSeparator>
                <IconChevronRight size={14} />
              </BreadcrumbSeparator>
              <BreadcrumbItem>
                {isLast ? (
                  <BreadcrumbPage>{seg.name}</BreadcrumbPage>
                ) : (
                  <BreadcrumbLink asChild>
                    <Link
                      href={`/dashboard/files/folder/${seg.folderId}`}
                    >
                      {seg.name}
                    </Link>
                  </BreadcrumbLink>
                )}
              </BreadcrumbItem>
            </span>
          )
        })}
      </BreadcrumbList>
    </Breadcrumb>
  )
}
