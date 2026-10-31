import { and, eq, ne } from "drizzle-orm"

import type { getDb } from "@/db"
import {
  projectDuplicateDecisions,
  projects,
} from "@/db/schema"
import { activeRegistryProject } from "@/lib/project-registry-visibility"
import {
  findProjectDuplicateCandidates,
  projectDuplicatePairKey,
  type ProjectDuplicateCandidate,
  type ProjectDuplicateIdentity,
} from "@/lib/project-duplicate-detector"
import { readFeatureSettings } from "@/lib/feature-settings/server"

type Db = ReturnType<typeof getDb>

export type ProjectDuplicateScan = {
  readonly candidates: readonly ProjectDuplicateCandidate[]
  readonly scannedProjectCount: number
  readonly previouslyReviewedCount: number
}

export async function loadActiveProjectDuplicateIdentities(
  db: Db,
  organizationId: string,
): Promise<readonly ProjectDuplicateIdentity[]> {
  return db
    .select({
      id: projects.id,
      projectNumber: projects.projectNumber,
      name: projects.name,
      clientName: projects.clientName,
      address: projects.address,
      sageJobId: projects.sageJobId,
      sageJobNumber: projects.sageJobNumber,
      googleDriveFolderId: projects.googleDriveFolderId,
      buildertrendProjectId: projects.buildertrendProjectId,
      createdAt: projects.createdAt,
    })
    .from(projects)
    .where(
      and(
        eq(projects.organizationId, organizationId),
        ne(projects.status, "ARCHIVE"),
        activeRegistryProject(db),
      ),
    )
}

export async function scanOpenProjectDuplicateCandidates(
  db: Db,
  organizationId: string,
): Promise<ProjectDuplicateScan> {
  const [identities, decisions] = await Promise.all([
    loadActiveProjectDuplicateIdentities(db, organizationId),
    db
      .select({
        projectAId: projectDuplicateDecisions.projectAId,
        projectBId: projectDuplicateDecisions.projectBId,
        status: projectDuplicateDecisions.status,
        score: projectDuplicateDecisions.score,
        reasonsJson: projectDuplicateDecisions.reasonsJson,
      })
      .from(projectDuplicateDecisions)
      .where(eq(projectDuplicateDecisions.organizationId, organizationId)),
  ])
  const decisionsByPair = new Map(
    decisions.map((decision) => [
      projectDuplicatePairKey(decision.projectAId, decision.projectBId),
      decision,
    ]),
  )

  let previouslyReviewedCount = 0
  const settings = await readFeatureSettings(db, organizationId, "project-duplicates")
  const candidates = findProjectDuplicateCandidates(identities, {
    repeatOrderDepartments: new Set(settings.repeatOrderDepartments),
  }).filter(
    (candidate) => {
      const decision = decisionsByPair.get(
        projectDuplicatePairKey(candidate.first.id, candidate.second.id),
      )
      if (!decision) return true
      if (decision.status === "merged") return false

      previouslyReviewedCount += 1
      return false
    },
  )

  return {
    candidates,
    scannedProjectCount: identities.length,
    previouslyReviewedCount,
  }
}

export async function loadOpenProjectDuplicateCandidates(
  db: Db,
  organizationId: string,
): Promise<readonly ProjectDuplicateCandidate[]> {
  const scan = await scanOpenProjectDuplicateCandidates(db, organizationId)
  return scan.candidates
}

export async function findProspectiveProjectDuplicates(
  db: Db,
  organizationId: string,
  input: Omit<ProjectDuplicateIdentity, "id" | "createdAt">,
): Promise<readonly ProjectDuplicateCandidate[]> {
  const prospective: ProjectDuplicateIdentity = {
    ...input,
    id: `prospective-${crypto.randomUUID()}`,
    createdAt: new Date().toISOString(),
  }
  const [existing, settings] = await Promise.all([
    loadActiveProjectDuplicateIdentities(db, organizationId),
    readFeatureSettings(db, organizationId, "project-duplicates"),
  ])
  return findProjectDuplicateCandidates([prospective, ...existing], {
    repeatOrderDepartments: new Set(settings.repeatOrderDepartments),
  }).filter(
    (candidate) =>
      candidate.first.id === prospective.id ||
      candidate.second.id === prospective.id,
  )
}
