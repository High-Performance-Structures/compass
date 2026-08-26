import { and, eq, isNull, isNotNull, lt, or } from "drizzle-orm"

import type { getDb } from "@/db"
import {
  feedbackDeskItems,
  type FeedbackDeskItem,
} from "@/db/schema-jarvis"
import { getJarvisEnvValue } from "@/lib/jarvis/auth"
import {
  feedbackFeatureGithubIssueCreationIsBlocked,
} from "@/lib/jarvis/feedback-feature-priority"
import {
  GITHUB_FEEDBACK_PROJECT_TITLE,
  feedbackReference,
  githubFeedbackIssueContent,
} from "@/lib/jarvis/feedback-github-content"

type CompassDb = ReturnType<typeof getDb>

type GitHubFeedbackConfig = Readonly<{
  token: string
  repo: string
  projectId: string | null
}>

type GitHubIssueResponse = Readonly<{
  html_url?: unknown
  node_id?: unknown
  title?: unknown
  state?: unknown
}>

const GITHUB_ISSUE_CLAIM_LEASE_MS = 5 * 60 * 1_000

type GitHubIssueLookup = Readonly<{
  available: boolean
  issue: GitHubIssueResponse | null
}>

type GraphqlResponse = Readonly<{
  errors?: ReadonlyArray<Readonly<{ message?: unknown }>>
  data?: Readonly<{
    viewer?: Readonly<{
      projectsV2?: Readonly<{
        nodes?: ReadonlyArray<Readonly<{ id?: unknown; title?: unknown }>>
      }>
    }>
    organization?: Readonly<{
      projectsV2?: Readonly<{
        nodes?: ReadonlyArray<Readonly<{ id?: unknown; title?: unknown }>>
      }>
    }>
  }>
}>

function githubConfig(env: CloudflareEnv): GitHubFeedbackConfig | null {
  const token = getJarvisEnvValue(env, "GITHUB_TOKEN")
  const repo = getJarvisEnvValue(env, "GITHUB_REPO")
  if (!token || !repo) return null

  return {
    token,
    repo,
    projectId: getJarvisEnvValue(env, "GITHUB_FEEDBACK_PROJECT_ID"),
  }
}

function githubHeaders(token: string): Readonly<Record<string, string>> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "Content-Type": "application/json",
    "User-Agent": "compass-feedback-desk",
  }
}

async function githubGraphql(
  config: GitHubFeedbackConfig,
  query: string,
  variables: Readonly<Record<string, string | number>>,
): Promise<GraphqlResponse | null> {
  try {
    const response = await fetch("https://api.github.com/graphql", {
      method: "POST",
      headers: githubHeaders(config.token),
      body: JSON.stringify({ query, variables }),
    })
    if (!response.ok) return null
    return await response.json() as GraphqlResponse
  } catch {
    return null
  }
}

async function feedbackProjectId(
  config: GitHubFeedbackConfig,
): Promise<string | null> {
  if (config.projectId) return config.projectId

  const result = await githubGraphql(
    config,
    `query FeedbackProject($owner: String!, $first: Int!) {
      organization(login: $owner) {
        projectsV2(first: $first) { nodes { id title } }
      }
    }`,
    { owner: config.repo.split("/")[0] ?? "", first: 100 },
  )
  const projects = result?.data?.organization?.projectsV2?.nodes ?? []
  const matchingProject = projects.find(
    (project) => project.title === GITHUB_FEEDBACK_PROJECT_TITLE,
  )
  return typeof matchingProject?.id === "string"
    ? matchingProject.id
    : null
}

async function addIssueToFeedbackProject(
  config: GitHubFeedbackConfig,
  issueNodeId: string,
): Promise<void> {
  const projectId = await feedbackProjectId(config)
  if (!projectId) {
    console.error("feedback_github_project_not_found", {
      projectTitle: GITHUB_FEEDBACK_PROJECT_TITLE,
    })
    return
  }

  const result = await githubGraphql(
    config,
    `mutation AddFeedbackIssue($projectId: ID!, $contentId: ID!) {
      addProjectV2ItemById(input: { projectId: $projectId, contentId: $contentId }) {
        item { id }
      }
    }`,
    { projectId, contentId: issueNodeId },
  )
  if (result?.errors?.length || !result?.data) {
    console.error("feedback_github_project_add_failed", {
      error:
        typeof result?.errors?.[0]?.message === "string"
          ? result.errors[0].message
          : "GitHub Project mutation did not return data",
    })
  }
}

function issueResponse(value: unknown): GitHubIssueResponse | null {
  if (typeof value !== "object" || value === null) return null
  const htmlUrl = Reflect.get(value, "html_url")
  const nodeId = Reflect.get(value, "node_id")
  const title = Reflect.get(value, "title")
  return {
    html_url: typeof htmlUrl === "string" ? htmlUrl : undefined,
    node_id: typeof nodeId === "string" ? nodeId : undefined,
    title: typeof title === "string" ? title : undefined,
  }
}

function issueUrlForRepo(value: unknown, repo: string): string | null {
  if (typeof value !== "string") return null
  const escapedRepo = repo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return new RegExp(
    `^https://github\\.com/${escapedRepo}/issues/\\d+(?:/|$)`,
  ).test(value)
    ? value
    : null
}

async function findGithubIssueByReference(
  config: GitHubFeedbackConfig,
  item: Pick<FeedbackDeskItem, "id" | "kind">,
): Promise<GitHubIssueLookup> {
  // GitHub's issue-create endpoint has no documented idempotency contract.
  // Recover by the opaque Compass reference, and fail closed if the lookup is
  // unavailable so a retry never creates an unverified second issue.
  const reference = feedbackReference(item.id)
  const query = encodeURIComponent(
    `repo:${config.repo} is:issue in:title "${reference}"`,
  )
  try {
    const response = await fetch(
      `https://api.github.com/search/issues?q=${query}&per_page=10`,
      { headers: githubHeaders(config.token) },
    )
    if (!response.ok) return { available: false, issue: null }
    const payload: unknown = await response.json()
    if (typeof payload !== "object" || payload === null) {
      return { available: false, issue: null }
    }
    const items = Reflect.get(payload, "items")
    if (!Array.isArray(items)) return { available: false, issue: null }
    const expectedTitle = githubFeedbackIssueContent(item).title
    for (const candidate of items) {
      const issue = issueResponse(candidate)
      if (
        issue?.title === expectedTitle &&
        issueUrlForRepo(issue.html_url, config.repo)
      ) {
        return { available: true, issue }
      }
    }
    return { available: true, issue: null }
  } catch {
    return { available: false, issue: null }
  }
}

function rowIdentity(
  item: Pick<FeedbackDeskItem, "organizationId">,
): ReturnType<typeof eq> {
  return item.organizationId === null
    ? isNull(feedbackDeskItems.organizationId)
    : eq(feedbackDeskItems.organizationId, item.organizationId)
}

async function clearGithubIssueCreationClaim(
  db: CompassDb,
  item: Pick<FeedbackDeskItem, "id" | "organizationId">,
  claimToken: string,
  clearProviderAttempt = false,
): Promise<void> {
  await db.update(feedbackDeskItems).set({
    githubIssueCreationClaimToken: null,
    githubIssueCreationClaimedAt: null,
    githubIssueCreationClaimExpiresAt: null,
    ...(clearProviderAttempt
      ? { githubIssueCreationProviderAttemptedAt: null }
      : {}),
    updatedAt: new Date().toISOString(),
  }).where(and(
    eq(feedbackDeskItems.id, item.id),
    rowIdentity(item),
    eq(feedbackDeskItems.githubIssueCreationClaimToken, claimToken),
  ))
}

export async function linkFeedbackDeskItemToGithub(
  db: CompassDb,
  env: CloudflareEnv,
  item: FeedbackDeskItem,
): Promise<string | null> {
  const config = githubConfig(env)
  if (!config) return null

  const currentItem = await db.select().from(feedbackDeskItems).where(and(
    eq(feedbackDeskItems.id, item.id),
    item.organizationId === null
      ? isNull(feedbackDeskItems.organizationId)
      : eq(feedbackDeskItems.organizationId, item.organizationId),
  )).get()
  if (!currentItem) return null

  if (currentItem.githubIssueUrl) {
    let nodeId = currentItem.githubIssueNodeId
    if (!nodeId) {
      const match = currentItem.githubIssueUrl.match(
        /^https:\/\/github\.com\/([^/]+\/[^/]+)\/issues\/(\d+)(?:\/|$)/,
      )
      if (match?.[1] === config.repo && match[2]) {
        try {
          const response = await fetch(
            `https://api.github.com/repos/${config.repo}/issues/${match[2]}`,
            { headers: githubHeaders(config.token) },
          )
          if (response.ok) {
            const issue = await response.json() as GitHubIssueResponse
            if (typeof issue.node_id === "string") {
              nodeId = issue.node_id
              await db.update(feedbackDeskItems).set({
                githubIssueNodeId: nodeId,
                updatedAt: new Date().toISOString(),
              }).where(and(
                eq(feedbackDeskItems.id, currentItem.id),
                item.organizationId === null
                  ? isNull(feedbackDeskItems.organizationId)
                  : eq(feedbackDeskItems.organizationId, item.organizationId),
              ))
            }
          }
        } catch {
          // The next maintenance run will retry this safe lookup.
        }
      }
    }
    if (nodeId) {
      await addIssueToFeedbackProject(config, nodeId)
    }
    return currentItem.githubIssueUrl
  }

  if (feedbackFeatureGithubIssueCreationIsBlocked(currentItem)) {
    return null
  }

  const claimToken = crypto.randomUUID()
  const claimedAt = new Date().toISOString()
  const claimExpiresAt = new Date(
    Date.now() + GITHUB_ISSUE_CLAIM_LEASE_MS,
  ).toISOString()
  const claimRows = await db.update(feedbackDeskItems).set({
    githubIssueCreationClaimToken: claimToken,
    githubIssueCreationClaimedAt: claimedAt,
    githubIssueCreationClaimExpiresAt: claimExpiresAt,
    updatedAt: claimedAt,
  }).where(and(
    eq(feedbackDeskItems.id, currentItem.id),
    rowIdentity(currentItem),
    isNull(feedbackDeskItems.githubIssueUrl),
    or(
      isNull(feedbackDeskItems.githubIssueCreationClaimToken),
      isNull(feedbackDeskItems.githubIssueCreationClaimExpiresAt),
      lt(feedbackDeskItems.githubIssueCreationClaimExpiresAt, claimedAt),
    ),
    isNotNull(feedbackDeskItems.githubIssueCreationApprovedAt),
    ...(currentItem.kind === "feature"
      ? [isNotNull(feedbackDeskItems.featurePriorityApprovedAt)]
      : []),
  )).returning({ id: feedbackDeskItems.id })
  if (claimRows.length === 0) return null

  const claimedItem = await db.select().from(feedbackDeskItems).where(and(
    eq(feedbackDeskItems.id, currentItem.id),
    rowIdentity(currentItem),
    eq(feedbackDeskItems.githubIssueCreationClaimToken, claimToken),
    isNull(feedbackDeskItems.githubIssueUrl),
    isNotNull(feedbackDeskItems.githubIssueCreationApprovedAt),
    ...(currentItem.kind === "feature"
      ? [isNotNull(feedbackDeskItems.featurePriorityApprovedAt)]
      : []),
  )).get()
  if (!claimedItem) {
    await clearGithubIssueCreationClaim(db, currentItem, claimToken)
    return null
  }

  const issueContent = githubFeedbackIssueContent(claimedItem)
  const releaseClaim = async (): Promise<void> => {
    await clearGithubIssueCreationClaim(db, currentItem, claimToken)
  }
  let providerRequestStarted = false
  try {
    const recoveredLookup = await findGithubIssueByReference(config, claimedItem)
    if (!recoveredLookup.available) {
      await releaseClaim()
      return null
    }
    const recoveredIssue = recoveredLookup.issue
    const recoveredUrl = issueUrlForRepo(recoveredIssue?.html_url, config.repo)
    if (recoveredIssue && recoveredUrl) {
      const recoveredRows = await db.update(feedbackDeskItems).set({
        githubIssueUrl: recoveredUrl,
        githubIssueNodeId:
          typeof recoveredIssue.node_id === "string" ? recoveredIssue.node_id : null,
        githubIssueCreationClaimToken: null,
        githubIssueCreationClaimedAt: null,
        githubIssueCreationClaimExpiresAt: null,
        githubIssueCreationProviderAttemptedAt: null,
        updatedAt: new Date().toISOString(),
      }).where(and(
        eq(feedbackDeskItems.id, claimedItem.id),
        rowIdentity(claimedItem),
        isNull(feedbackDeskItems.githubIssueUrl),
        eq(feedbackDeskItems.githubIssueCreationClaimToken, claimToken),
        eq(feedbackDeskItems.updatedAt, claimedItem.updatedAt),
        isNotNull(feedbackDeskItems.githubIssueCreationApprovedAt),
        ...(claimedItem.kind === "feature"
          ? [isNotNull(feedbackDeskItems.featurePriorityApprovedAt)]
          : []),
      )).returning({ id: feedbackDeskItems.id })
      if (recoveredRows.length === 0) {
        await releaseClaim()
        return null
      }
      if (typeof recoveredIssue.node_id === "string") {
        await addIssueToFeedbackProject(config, recoveredIssue.node_id)
      }
      return recoveredUrl
    }

    if (claimedItem.githubIssueCreationProviderAttemptedAt) {
      // A prior POST may have succeeded even if the provider lookup is still
      // eventually consistent. Never create a second issue without recovery.
      await releaseClaim()
      return null
    }

    const stillApproved = await db.select({ id: feedbackDeskItems.id })
      .from(feedbackDeskItems).where(and(
        eq(feedbackDeskItems.id, claimedItem.id),
        rowIdentity(claimedItem),
        isNull(feedbackDeskItems.githubIssueUrl),
        eq(feedbackDeskItems.githubIssueCreationClaimToken, claimToken),
        eq(feedbackDeskItems.updatedAt, claimedItem.updatedAt),
        isNotNull(feedbackDeskItems.githubIssueCreationApprovedAt),
        ...(claimedItem.kind === "feature"
          ? [isNotNull(feedbackDeskItems.featurePriorityApprovedAt)]
          : []),
      )).get()
    if (!stillApproved) {
      await releaseClaim()
      return null
    }

    const providerAttemptedAt = new Date().toISOString()
    const providerStartRows = await db.update(feedbackDeskItems).set({
      githubIssueCreationProviderAttemptedAt: providerAttemptedAt,
    }).where(and(
      eq(feedbackDeskItems.id, claimedItem.id),
      rowIdentity(claimedItem),
      isNull(feedbackDeskItems.githubIssueUrl),
      eq(feedbackDeskItems.githubIssueCreationClaimToken, claimToken),
      eq(feedbackDeskItems.updatedAt, claimedItem.updatedAt),
      isNotNull(feedbackDeskItems.githubIssueCreationApprovedAt),
      ...(claimedItem.kind === "feature"
        ? [isNotNull(feedbackDeskItems.featurePriorityApprovedAt)]
        : []),
    )).returning({ id: feedbackDeskItems.id })
    if (providerStartRows.length === 0) {
      await releaseClaim()
      return null
    }
    providerRequestStarted = true

    const response = await fetch(
      `https://api.github.com/repos/${config.repo}/issues`,
      {
        method: "POST",
        headers: githubHeaders(config.token),
        body: JSON.stringify(issueContent),
      },
    )
    if (!response.ok) {
      console.error("feedback_github_issue_failed", {
        feedbackDeskItemId: item.id,
        status: response.status,
      })
      await clearGithubIssueCreationClaim(db, currentItem, claimToken, true)
      return null
    }
    const issue = issueResponse(await response.json())
    const issueUrl = issueUrlForRepo(issue?.html_url, config.repo)
    if (!issue || !issueUrl) {
      return null
    }

    const linkedRows = await db
      .update(feedbackDeskItems)
      .set({
        githubIssueUrl: issueUrl,
        githubIssueNodeId:
          typeof issue.node_id === "string" ? issue.node_id : null,
        githubIssueCreationClaimToken: null,
        githubIssueCreationClaimedAt: null,
        githubIssueCreationClaimExpiresAt: null,
        githubIssueCreationProviderAttemptedAt: null,
        updatedAt: new Date().toISOString(),
      })
      .where(and(
        eq(feedbackDeskItems.id, claimedItem.id),
        rowIdentity(claimedItem),
        isNull(feedbackDeskItems.githubIssueUrl),
        eq(feedbackDeskItems.githubIssueCreationClaimToken, claimToken),
        eq(feedbackDeskItems.updatedAt, claimedItem.updatedAt),
        isNotNull(feedbackDeskItems.githubIssueCreationApprovedAt),
        ...(claimedItem.kind === "feature"
          ? [isNotNull(feedbackDeskItems.featurePriorityApprovedAt)]
          : []),
      ))
      .returning({ id: feedbackDeskItems.id })

    if (linkedRows.length === 0) return null

    if (typeof issue.node_id === "string") {
      await addIssueToFeedbackProject(config, issue.node_id)
    }
    return issueUrl
  } catch (error) {
    if (!providerRequestStarted) await releaseClaim()
    console.error("feedback_github_issue_failed", {
      feedbackDeskItemId: currentItem.id,
      error: error instanceof Error ? error.message : "Unknown error",
    })
    return null
  }
}
