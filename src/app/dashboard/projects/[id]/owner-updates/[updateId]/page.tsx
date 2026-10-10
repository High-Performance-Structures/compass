export const dynamic = "force-dynamic"

import { currentDepartmentProfiles } from "@/lib/department-profiles-server"
import { decodeProjectRouteId } from "@/lib/project-route-id"
import type * as React from "react"
import { notFound, redirect } from "next/navigation"

import {
  getOwnerProjectUpdateDocument,
  type OwnerProjectUpdateDocument as OwnerProjectUpdateDocumentData,
} from "@/app/actions/project-field"
import { OwnerUpdateDocument } from "@/components/projects/owner-update-document"
import { redirectIfFeaturePermissionDenied } from "@/lib/permission-redirect"

function hasDigest(error: unknown): error is { readonly digest: string } {
  return typeof error === "object" && error !== null && "digest" in error
}

export default async function OwnerUpdatePage({
  params,
}: {
  readonly params: Promise<{ readonly id: string; readonly updateId: string }>
}): Promise<React.ReactElement> {
  const { id: rawProjectId, updateId } = await params
  const id = decodeProjectRouteId(rawProjectId)
  let document: OwnerProjectUpdateDocumentData

  try {
    document = await getOwnerProjectUpdateDocument(id, updateId)
  } catch (error) {
    if (hasDigest(error) && error.digest === "NEXT_NOT_FOUND") throw error
    redirectIfFeaturePermissionDenied(error)
    // A deleted draft (including the one just deleted from this page, which
    // Next re-renders when the delete action revalidates) goes back to the
    // project's owner updates instead of a 404.
    if (error instanceof Error && error.message === "Owner update not found") {
      redirect(`/dashboard/projects/${rawProjectId}/owner-updates`)
    }
    notFound()
  }

  return <OwnerUpdateDocument document={document} profiles={await currentDepartmentProfiles()} />
}
