import { and, eq, notExists } from "drizzle-orm"

import type { getDb } from "@/db"
import {
  projectDuplicateDecisions,
  projectRouteAliases,
  projects,
} from "@/db/schema"
import {
  findProjectDuplicateCandidates,
  projectDuplicatePairKey,
  type ProjectDuplicateCandidate,
  type ProjectDuplicateIdentity,
  type ProjectDuplicateReasonCode,
} from "@/lib/project-duplicate-detector"

type Db = ReturnType<typeof getDb>

const EXACT_IDENTIFIER_REASONS: ReadonlySet<ProjectDuplicateReasonCode> =
  new Set([
    "project_number",
    "project_department_sequence",
    "sage_job_id",
    "sage_job_number",
    "drive_folder",
    "buildertrend_project",
  ])

function savedReasonCodes(reasonsJson: string): ReadonlySet<string> {
  try {
    const parsed: unknown = JSON.parse(reasonsJson)
    if (!Array.isArray(parsed)) return new Set()
    return new Set(
      parsed.flatMap((reason) => {
        if (
          reason !== null &&
          typeof reason === "object" &&
          "code" in reason &&
          typeof reason.code === "string"
        ) {
          return [reason.code]
        }
        return []
      }),
    )
  } catch {
    return new Set()
  }
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
        notExists(
          db
            .select({ sourceProjectId: projectRouteAliases.sourceProjectId })
            .from(projectRouteAliases)
            .where(eq(projectRouteAliases.sourceProjectId, projects.id)),
        ),
        notExists(
          db
            .select({
              removedProjectId: projectDuplicateDecisions.removedProjectId,
            })
            .from(projectDuplicateDecisions)
            .where(
              and(
                eq(projectDuplicateDecisions.status, "merged"),
                eq(projectDuplicateDecisions.removedProjectId, projects.id),
              ),
            ),
        ),
      ),
    )
}

export async function loadOpenProjectDuplicateCandidates(
  db: Db,
  organizationId: string,
): Promise<readonly ProjectDuplicateCandidate[]> {
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

  return findProjectDuplicateCandidates(identities).filter((candidate) => {
    const decision = decisionsByPair.get(
      projectDuplicatePairKey(candidate.first.id, candidate.second.id),
    )
    if (!decision) return true
    if (decision.status === "merged") return false

    const previousReasonCodes = savedReasonCodes(decision.reasonsJson)
    const hasNewExactIdentifier = candidate.reasons.some(
      (reason) =>
        EXACT_IDENTIFIER_REASONS.has(reason.code) &&
        !previousReasonCodes.has(reason.code),
    )
    return hasNewExactIdentifier || candidate.score >= decision.score + 15
  })
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
  const existing = await loadActiveProjectDuplicateIdentities(db, organizationId)
  return findProjectDuplicateCandidates([prospective, ...existing]).filter(
    (candidate) =>
      candidate.first.id === prospective.id ||
      candidate.second.id === prospective.id,
  )
}
