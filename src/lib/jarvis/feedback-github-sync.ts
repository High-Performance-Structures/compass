import type { getDb } from "@/db"
import { type FeedbackDeskItem } from "@/db/schema-jarvis"
import { getJarvisEnvValue } from "@/lib/jarvis/auth"
import {
  GITHUB_FEEDBACK_PROJECT_TITLE,
  feedbackReference,
} from "@/lib/jarvis/feedback-github-content"
import {
  knownFeedbackStatus,
  type FeedbackDeskStatus,
} from "@/lib/jarvis/feedback-lifecycle"
import { feedbackFeatureTransitionIsBlocked } from "@/lib/jarvis/feedback-feature-priority"
import { applyFeedbackLifecycleUpdate } from "@/lib/jarvis/feedback-status-update"

type CompassDb = ReturnType<typeof getDb>
type GithubProjectState = Readonly<{
  issueNodeId: string
  issueTitle: string
  issueUrl: string
  issueState: string
  projectStatus: string | null
  pullRequestUrl: string | null
}>

function objectValue(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? Object.fromEntries(Object.entries(value))
    : null
}

function stringValue(record: Record<string, unknown> | null, key: string): string | null {
  const value = record?.[key]
  return typeof value === "string" ? value : null
}

function projectStatusFromFieldValues(value: unknown): string | null {
  const nodes = objectValue(value)?.nodes
  if (!Array.isArray(nodes)) return null
  for (const node of nodes) {
    const fieldValue = objectValue(node)
    const field = objectValue(fieldValue?.field)
    if (stringValue(field, "name")?.toLowerCase() === "status") {
      return stringValue(fieldValue, "name")
    }
  }
  return null
}

function projectStatesFromGraphql(value: unknown): readonly GithubProjectState[] {
  const data = objectValue(objectValue(value)?.data)
  const project = objectValue(data?.node)
  const nodes = objectValue(project?.items)?.nodes
  if (!Array.isArray(nodes)) return []
  const results: GithubProjectState[] = []
  for (const node of nodes) {
    const projectItem = objectValue(node)
    const content = objectValue(projectItem?.content)
    const issueNodeId = stringValue(content, "id")
    const issueTitle = stringValue(content, "title")
    const issueUrl = stringValue(content, "url")
    if (!issueNodeId || !issueTitle || !issueUrl) continue
    results.push({
      issueNodeId,
      issueTitle,
      issueUrl,
      issueState: stringValue(content, "state") ?? "OPEN",
      projectStatus: projectStatusFromFieldValues(projectItem?.fieldValues),
      pullRequestUrl: (() => {
        const pullRequests = objectValue(content?.closedByPullRequestsReferences)?.nodes
        if (!Array.isArray(pullRequests)) return null
        const latest = pullRequests.at(-1)
        return stringValue(objectValue(latest), "url")
      })(),
    })
  }
  return results
}

export function feedbackStatusFromGithub(
  projectStatus: string | null,
  issueState: string,
): FeedbackDeskStatus | null {
  const status = projectStatus?.trim().toLowerCase() ?? ""
  if (/(cancel|won't do|wont do|duplicate)/.test(status)) return "closed"
  if (/(done|complete|deployed|released)/.test(status)) return "deployed"
  if (/(test|review|verify|qa)/.test(status)) return "testing"
  if (/(progress|develop|working)/.test(status)) return "in_progress"
  if (/(ready|planned|scheduled|accepted)/.test(status)) return "planned"
  if (/(triage|backlog)/.test(status)) return "triaged"
  if (issueState.toUpperCase() === "CLOSED") return "closed"
  return status.length > 0 ? "triaged" : null
}

async function githubProjectStates(env: CloudflareEnv): Promise<readonly GithubProjectState[]> {
  const token = getJarvisEnvValue(env, "GITHUB_TOKEN")
  const configuredProjectId = getJarvisEnvValue(env, "GITHUB_FEEDBACK_PROJECT_ID")
  const repo = getJarvisEnvValue(env, "GITHUB_REPO")
  if (!token) return []
  try {
    let projectId = configuredProjectId
    if (!projectId && repo) {
      const owner = repo.split("/")[0] ?? ""
      const lookupResponse = await fetch("https://api.github.com/graphql", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "Content-Type": "application/json",
          "User-Agent": "compass-feedback-desk",
        },
        body: JSON.stringify({
          query: `query FeedbackProjectLookup($owner: String!) {
            organization(login: $owner) {
              projectsV2(first: 100) { nodes { id title } }
            }
          }`,
          variables: { owner },
        }),
      })
      if (lookupResponse.ok) {
        const lookup = objectValue(await lookupResponse.json())
        const data = objectValue(lookup?.data)
        const organization = objectValue(data?.organization)
        const projects = objectValue(organization?.projectsV2)?.nodes
        if (Array.isArray(projects)) {
          const matchingProject = projects.find((value) => {
            const project = objectValue(value)
            return stringValue(project, "title") === GITHUB_FEEDBACK_PROJECT_TITLE
          })
          projectId = stringValue(objectValue(matchingProject), "id")
        }
      }
    }
    if (!projectId) return []
    const response = await fetch("https://api.github.com/graphql", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        "User-Agent": "compass-feedback-desk",
      },
      body: JSON.stringify({
        query: `query FeedbackProjectStatuses($projectId: ID!) {
          node(id: $projectId) {
            ... on ProjectV2 {
              items(first: 100) {
                nodes {
                  content {
                    ... on Issue {
                      id
                      title
                      url
                      state
                      closedByPullRequestsReferences(first: 10) {
                        nodes { url }
                      }
                    }
                  }
                  fieldValues(first: 20) {
                    nodes {
                      ... on ProjectV2ItemFieldSingleSelectValue {
                        name
                        field { ... on ProjectV2FieldCommon { name } }
                      }
                    }
                  }
                }
              }
            }
          }
        }`,
        variables: { projectId },
      }),
    })
    if (!response.ok) return []
    return projectStatesFromGraphql(await response.json())
  } catch {
    return []
  }
}

export async function syncFeedbackDeskItemsFromGithub(
  db: CompassDb,
  env: CloudflareEnv,
  items: readonly FeedbackDeskItem[],
): Promise<number> {
  const states = await githubProjectStates(env)
  if (states.length === 0) return 0
  const stateByIssue = new Map(states.map((state) => [state.issueNodeId, state]))
  let updatedCount = 0

  for (const item of items) {
    const reference = feedbackReference(item.id)
    const referenceMatches = states.filter((state) =>
      state.issueTitle.includes(reference),
    )
    const state = item.githubIssueNodeId
      ? stateByIssue.get(item.githubIssueNodeId)
      : referenceMatches.length === 1
        ? referenceMatches[0]
        : undefined
    if (!state) continue
    const nextStatus = feedbackStatusFromGithub(state.projectStatus, state.issueState)
    const needsLink =
      item.githubIssueNodeId !== state.issueNodeId ||
      item.githubIssueUrl !== state.issueUrl
    const needsStatus = nextStatus !== null && nextStatus !== item.status
    const needsPullRequest =
      state.pullRequestUrl !== null &&
      state.pullRequestUrl !== item.githubDraftPullRequestUrl
    if (!needsLink && !needsStatus && !needsPullRequest) continue
    if (feedbackFeatureTransitionIsBlocked({
      currentStatus: item.status,
      featurePriorityApprovedAt: item.featurePriorityApprovedAt,
      kind: item.kind,
      nextStatus: nextStatus ?? knownFeedbackStatus(item.status),
    })) continue

    const message = state.projectStatus
      ? `The Feedback Desk moved this request to ${state.projectStatus}.`
      : `The linked GitHub issue is now ${state.issueState.toLowerCase()}.`
    await applyFeedbackLifecycleUpdate(db, item, {
      status: nextStatus ?? knownFeedbackStatus(item.status),
      message,
      githubIssueNodeId: state.issueNodeId,
      githubIssueUrl: state.issueUrl,
      draftPullRequestUrl: state.pullRequestUrl ?? undefined,
      actorSource: "github",
      idempotencyKey:
        `github-status:${item.id}:${nextStatus ?? item.status}:${state.projectStatus ?? state.issueState}`,
    })
    updatedCount += 1
  }
  return updatedCount
}
