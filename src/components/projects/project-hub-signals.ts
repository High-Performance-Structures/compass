import type { DashboardOverview } from "@/app/actions/dashboard-overview"

/** The job-health line a Project Hub card shows for one project. */
export type ProjectHubHealth = {
  readonly progress: number
  readonly openRfiCount: number
  readonly openPoCount: number
  readonly nextTaskTitle: string | null
}

/** The field photo a Project Hub card shows for one project. */
export type ProjectHubPhoto = {
  readonly imageUrl: string
  readonly caption: string | null
  readonly fileName: string
}

/**
 * The slice of the dashboard overview the Project Hub cards read, keyed by
 * project id. The full overview carries every project's tasks, logs and
 * owner updates; the hub only needs these few fields, so the page sends this
 * instead of the whole overview to the browser.
 */
export type ProjectHubSignals = {
  readonly health: Readonly<Record<string, ProjectHubHealth>>
  readonly photos: Readonly<Record<string, ProjectHubPhoto>>
}

export function projectHubSignals(
  overview: Pick<DashboardOverview, "projects" | "fieldPhotos">,
): ProjectHubSignals {
  const health: Record<string, ProjectHubHealth> = {}
  for (const project of overview.projects) {
    // The cards used the first matching project, so keep the first.
    if (Object.hasOwn(health, project.id)) continue
    health[project.id] = {
      progress: project.progress,
      openRfiCount: project.openRfiCount,
      openPoCount: project.openPoCount,
      nextTaskTitle: project.nextTask?.title ?? null,
    }
  }
  const photos: Record<string, ProjectHubPhoto> = {}
  for (const photo of overview.fieldPhotos) {
    if (Object.hasOwn(photos, photo.projectId)) continue
    photos[photo.projectId] = {
      imageUrl: photo.imageUrl,
      caption: photo.caption,
      fileName: photo.fileName,
    }
  }
  return { health, photos }
}

export function projectHubHealth(
  signals: ProjectHubSignals,
  projectId: string,
): ProjectHubHealth | null {
  return Object.hasOwn(signals.health, projectId) ? (signals.health[projectId] ?? null) : null
}

export function projectHubPhoto(
  signals: ProjectHubSignals,
  projectId: string,
): ProjectHubPhoto | null {
  return Object.hasOwn(signals.photos, projectId) ? (signals.photos[projectId] ?? null) : null
}
