"use client"

import Link from "next/link"
import type * as React from "react"
import {
  IconArrowLeft,
  IconDownload,
} from "@tabler/icons-react"

import { Button } from "@/components/ui/button"

export function ProjectContractPacketPreview({
  projectId,
  packetId,
  packetNumber,
  versionNumber,
}: {
  readonly projectId: string
  readonly packetId: string
  readonly packetNumber: string
  readonly versionNumber: number
}): React.ReactElement {
  const pdfUrl = `/api/projects/${projectId}/contract-packets/${packetId}/pdf`

  return (
    <div className="min-h-screen bg-muted/50 text-foreground">
      <style>{`
        @page { size: letter; margin: 0; }
        @media print {
          body { background: white !important; }
          .contract-preview-actions { display: none !important; }
          .contract-preview-pages { gap: 0 !important; padding: 0 !important; }
          .contract-preview-page { break-after: page; max-width: none !important; }
          .contract-preview-page:last-child { break-after: auto; }
        }
      `}</style>
      <header className="contract-preview-actions sticky top-0 z-10 border-b bg-background/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-[8.5in] flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <Button variant="ghost" size="sm" asChild>
              <Link href={`/dashboard/projects/${projectId}/contracts?packetId=${packetId}`}>
                <IconArrowLeft className="size-4" />Contract packet
              </Link>
            </Button>
            <div className="min-w-0 border-l pl-3">
              <h1 className="truncate text-sm font-semibold">
                {packetNumber} · contract packet preview
              </h1>
              <p className="text-xs text-muted-foreground">Version {versionNumber}</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" asChild>
              <a
                href={pdfUrl}
                download={`${packetNumber}-contract-v${versionNumber}.pdf`}
              >
                <IconDownload className="size-4" />Download PDF
              </a>
            </Button>
          </div>
        </div>
      </header>

      <main className="contract-preview-pages min-h-[70vh] p-4 md:p-8">
        <iframe
          src={pdfUrl}
          title={`${packetNumber} contract packet preview`}
          className="h-[calc(100vh-9rem)] min-h-[70vh] w-full border-0 bg-background"
        />
      </main>
    </div>
  )
}
