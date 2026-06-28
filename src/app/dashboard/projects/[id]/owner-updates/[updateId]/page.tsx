export const dynamic = "force-dynamic"

import type * as React from "react"
import { headers } from "next/headers"
import { notFound } from "next/navigation"

import {
  getOwnerProjectUpdateDocument,
  type OwnerProjectUpdateDocument as OwnerProjectUpdateDocumentData,
} from "@/app/actions/project-field"
import { OwnerUpdateDocument } from "@/components/projects/owner-update-document"

function hasDigest(error: unknown): error is { readonly digest: string } {
  return typeof error === "object" && error !== null && "digest" in error
}

function requestOrigin(headerStore: {
  readonly get: (name: string) => string | null
}): string | null {
  const forwardedHost = headerStore.get("x-forwarded-host")
  const host = forwardedHost ?? headerStore.get("host")
  if (host === null) return null

  const forwardedProto = headerStore.get("x-forwarded-proto")
  const proto =
    forwardedProto ?? (host.startsWith("localhost") ? "http" : "https")

  return `${proto}://${host}`
}

export default async function OwnerUpdatePage({
  params,
}: {
  readonly params: Promise<{ readonly id: string; readonly updateId: string }>
}): Promise<React.ReactElement> {
  const { id, updateId } = await params
  let document: OwnerProjectUpdateDocumentData

  try {
    document = await getOwnerProjectUpdateDocument(id, updateId)
  } catch (error) {
    if (hasDigest(error) && error.digest === "NEXT_NOT_FOUND") throw error
    notFound()
  }

  const origin = requestOrigin(await headers())
  const updatePath =
    `/dashboard/projects/${document.project.id}` +
    `/owner-updates/${document.update.id}`
  const absoluteUpdateUrl =
    origin === null ? undefined : new URL(updatePath, origin).toString()

  return (
    <OwnerUpdateDocument
      document={document}
      absoluteUpdateUrl={absoluteUpdateUrl}
    />
  )
}
