"use server"

import { and, desc, eq, gte, isNull } from "drizzle-orm"
import { getDb } from "@/db"
import { projectContacts, projectFollowUps, projectInteractions, users } from "@/db/schema"
import { getProjects } from "@/app/actions/projects"
import { getCurrentUser } from "@/lib/auth"
import {
  buildLeaderboard,
  isClientFollowUpPeriod,
  periodStart,
  type ClientFollowUpPeriod,
  type ClientFollowUpSettings,
  type LeaderboardEntry,
} from "@/lib/client-follow-up/leaderboard"
import { getCloudflareContext } from "@/lib/db"
import { readFeatureSettings } from "@/lib/feature-settings/server"
import { loadProjectFollowUpSignals } from "@/lib/project-aging-server"
import type { ProjectFollowUpSignal } from "@/lib/project-follow-up"
import { projectInteractionTypeLabel } from "@/lib/project-profile"
import { isInternalStaffRole } from "@/lib/user-roles"

export type ClientFollowUpJob = {
  readonly id: string
  readonly name: string
  readonly projectNumber: string | null
  readonly clientName: string | null
  readonly jobStatusLabel: string
  readonly clientStatus: string
  readonly signal: ProjectFollowUpSignal
  readonly ownerName: string | null
  readonly ownerUserId: string | null
  /** Logged contacts in the selected period. */
  readonly periodInteractions: number
}

export type ClientFollowUpInteraction = {
  readonly id: string
  readonly projectId: string
  readonly projectLabel: string
  readonly interactionType: string
  readonly interactionTypeLabel: string
  readonly direction: string
  readonly summary: string
  readonly occurredAt: string
  readonly source: string
  readonly createdBy: string | null
  readonly createdByName: string | null
  readonly contactName: string | null
}

export type ClientFollowUpWorkspace = {
  readonly period: ClientFollowUpPeriod
  readonly periodStart: string
  readonly viewerId: string
  readonly settings: ClientFollowUpSettings
  readonly jobs: readonly ClientFollowUpJob[]
  readonly interactions: readonly ClientFollowUpInteraction[]
  readonly leaderboard: readonly LeaderboardEntry[]
}

const STREAK_WINDOW_DAYS = 90
const MAX_FEED = 500

function personName(row: { readonly displayName: string | null; readonly firstName: string | null; readonly lastName: string | null; readonly email: string | null }): string | null {
  const named = row.displayName?.trim()
  if (named) return named
  const full = [row.firstName, row.lastName].filter((part) => part && part.trim()).join(" ").trim()
  return full || row.email
}

/**
 * Everything the Client follow-up page shows: every followed-up job the viewer
 * can see with its aging, the period's logged client interactions across those
 * jobs, and the team leaderboard. Office staff only.
 */
export async function getClientFollowUpWorkspace(
  requestedPeriod?: string,
): Promise<{ readonly success: true; readonly data: ClientFollowUpWorkspace } | { readonly success: false; readonly error: string }> {
  try {
    const user = await getCurrentUser()
    if (!user?.organizationId || !isInternalStaffRole(user.role)) {
      return { success: false, error: "Client follow-up is available to office staff." }
    }
    const organizationId = user.organizationId
    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)
    const settings = await readFeatureSettings(db, organizationId, "client-follow-up")
    const period = requestedPeriod && isClientFollowUpPeriod(requestedPeriod) ? requestedPeriod : settings.defaultPeriod
    const now = new Date()
    const start = periodStart(period, now)
    const streakStart = new Date(now.getTime() - STREAK_WINDOW_DAYS * 86_400_000)
    const earliest = start < streakStart ? start : streakStart

    // getProjects applies the viewer's project access.
    const visible = await getProjects()
    const signals = await loadProjectFollowUpSignals(db, organizationId, visible, now)
    const followed = visible.filter((project) => signals.has(project.id))
    const visibleIds = visible.map((project) => project.id)
    const labelById = new Map(visible.map((project) => [project.id, project.projectNumber ? `${project.projectNumber} · ${project.name}` : project.name]))

    const [owners, interactionRows] = await Promise.all([
      followed.length
        ? db
            .select({
              projectId: projectFollowUps.projectId,
              ownerUserId: projectFollowUps.ownerUserId,
              displayName: users.displayName,
              firstName: users.firstName,
              lastName: users.lastName,
              email: users.email,
            })
            .from(projectFollowUps)
            .leftJoin(users, eq(users.id, projectFollowUps.ownerUserId))
            .where(eq(projectFollowUps.organizationId, organizationId))
        : Promise.resolve([]),
      visibleIds.length
        ? db
            .select({
              id: projectInteractions.id,
              projectId: projectInteractions.projectId,
              interactionType: projectInteractions.interactionType,
              direction: projectInteractions.direction,
              summary: projectInteractions.summary,
              occurredAt: projectInteractions.occurredAt,
              source: projectInteractions.source,
              createdBy: projectInteractions.createdBy,
              displayName: users.displayName,
              firstName: users.firstName,
              lastName: users.lastName,
              email: users.email,
              contactName: projectContacts.displayName,
            })
            .from(projectInteractions)
            .leftJoin(users, eq(users.id, projectInteractions.createdBy))
            .leftJoin(projectContacts, eq(projectContacts.id, projectInteractions.projectContactId))
            .where(
              and(
                eq(projectInteractions.organizationId, organizationId),
                eq(projectInteractions.qualifiesForClientTouch, true),
                isNull(projectInteractions.deletedAt),
                gte(projectInteractions.occurredAt, earliest.toISOString()),
              ),
            )
            .orderBy(desc(projectInteractions.occurredAt))
        : Promise.resolve([]),
    ])
    const ownerById = new Map(owners.map((row) => [row.projectId, row]))
    // Filter to the viewer's projects here; an id list could exceed D1's parameter cap.
    const visibleIdSet = new Set(visibleIds)
    const all: ClientFollowUpInteraction[] = interactionRows.filter((row) => visibleIdSet.has(row.projectId)).map((row) => ({
      id: row.id,
      projectId: row.projectId,
      projectLabel: labelById.get(row.projectId) ?? "Project",
      interactionType: row.interactionType,
      interactionTypeLabel: projectInteractionTypeLabel(row.interactionType),
      direction: row.direction,
      summary: row.summary,
      occurredAt: row.occurredAt,
      source: row.source,
      createdBy: row.createdBy,
      createdByName: row.createdBy ? personName(row) : null,
      contactName: row.contactName,
    }))
    const startIso = start.toISOString()
    const inPeriod = all.filter((item) => item.occurredAt >= startIso)
    const periodCountByProject = new Map<string, number>()
    for (const item of inPeriod) periodCountByProject.set(item.projectId, (periodCountByProject.get(item.projectId) ?? 0) + 1)

    const jobs: ClientFollowUpJob[] = followed.flatMap((project) => {
      const signal = signals.get(project.id)
      if (!signal) return []
      const owner = ownerById.get(project.id)
      return [{
        id: project.id,
        name: project.name,
        projectNumber: project.projectNumber,
        clientName: project.clientName,
        jobStatusLabel: project.jobStatusLabel,
        clientStatus: project.clientStatus,
        signal,
        ownerUserId: owner?.ownerUserId ?? null,
        ownerName: owner?.ownerUserId ? personName(owner) : null,
        periodInteractions: periodCountByProject.get(project.id) ?? 0,
      }]
    })

    return {
      success: true,
      data: {
        period,
        periodStart: startIso,
        viewerId: user.id,
        settings,
        jobs,
        interactions: inPeriod.slice(0, MAX_FEED),
        leaderboard: settings.leaderboardEnabled
          ? buildLeaderboard({
              periodInteractions: inPeriod,
              streakInteractions: all,
              countAutomaticEmails: settings.countAutomaticEmails,
              now,
            })
          : [],
      },
    }
  } catch (error) {
    console.error("Unable to load client follow-up", error)
    return { success: false, error: "Unable to load client follow-up." }
  }
}
