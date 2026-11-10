export const dynamic = "force-dynamic"

import type * as React from "react"

import { SaveToCompassForm } from "@/components/selections/save-to-compass-form"
import { getCurrentUser } from "@/lib/auth"
import { canFeature } from "@/lib/permission-enforcement"
import { listProjectsForCurrentUser } from "@/lib/projects/project-list"
import { fetchLinkPreview } from "@/lib/selections/link-preview"
import { isSaveTargetStatus, parseSaveToCompassQuery } from "@/lib/selections/save-to-compass"
import { isInternalStaffRole } from "@/lib/user-roles"

/*
 * The "Save to Compass" popup the bookmarks-bar button opens (about
 * 480x680, outside the dashboard shell so it fits a small window). It reads
 * the product page's address and title from the query, reads the preview
 * card server-side, and lets staff save the page as a choice on a selection
 * of an open or warranty job. Signed-out visitors get the normal login
 * redirect (middleware) and come back here afterwards.
 */
export default async function SaveToCompassPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ readonly url?: string | readonly string[]; readonly title?: string | readonly string[] }>
}): Promise<React.ReactElement> {
  const query = parseSaveToCompassQuery(await searchParams)
  const user = await getCurrentUser()
  const staff = user !== null && user.organizationType === "internal" && isInternalStaffRole(user.role)
  const allowed = staff && (await canFeature(user, "finish-selections", "update"))

  let body: React.ReactElement
  if (!allowed) {
    body = <Notice>Saving products to Compass is available to staff who can edit finish selections.</Notice>
  } else if (!query.ok) {
    body = <Notice>{query.error}</Notice>
  } else {
    const [preview, projects] = await Promise.all([fetchLinkPreview(query.url), listProjectsForCurrentUser()])
    const jobs = projects
      .filter((project) => isSaveTargetStatus(project.status))
      .map((project) => ({ id: project.id, name: project.name, projectNumber: project.projectNumber, clientName: project.clientName }))
    body = <SaveToCompassForm url={query.url} pageTitle={query.title} preview={preview} jobs={jobs} />
  }

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-lg flex-col gap-4 bg-background p-4 text-foreground">
      <h1 className="text-base font-semibold">Save to Compass</h1>
      {body}
    </main>
  )
}

function Notice({ children }: { readonly children: React.ReactNode }): React.ReactElement {
  return <p className="text-sm text-muted-foreground">{children}</p>
}
