"use client"

import Link from "next/link"
import { IconArrowLeft } from "@tabler/icons-react"

import { PdfDocumentPreview } from "@/components/print/pdf-document-preview"
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
  return (
    <PdfDocumentPreview
      title="Contract packet"
      documentNumber={`${packetNumber} v${versionNumber}`}
      pdfHref={`/api/projects/${projectId}/contract-packets/${packetId}/pdf`}
      preparingLabel="Preparing the numbered contract packet..."
      leading={
        <>
          <Button variant="ghost" size="sm" asChild>
            <Link href={`/dashboard/projects/${projectId}/contracts?packetId=${packetId}`}>
              <IconArrowLeft className="size-4" />Contract packet
            </Link>
          </Button>
          <div className="min-w-0 border-l pl-3">
            <h1 className="truncate text-sm font-semibold">{packetNumber} · contract packet</h1>
            <p className="text-xs text-muted-foreground">Version {versionNumber}</p>
          </div>
        </>
      }
    />
  )
}
