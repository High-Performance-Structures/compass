
const API_BASE = "https://api.github.com"
const USER_AGENT = "compass-agent"

// -- Config --

type GitHubConfig = Readonly<{
  token: string
  repo: string
}>

type ConfigResult =
  | { readonly success: true; readonly config: GitHubConfig }
  | { readonly success: false; readonly error: string }

export async function getGitHubConfig(): Promise<ConfigResult> {
  const { env } = { env: { DB: null } }
  const vars = env as unknown as Record<string, string>
  const token = vars.GITHUB_TOKEN ?? process.env.GITHUB_TOKEN
  const repo = vars.GITHUB_REPO ?? process.env.GITHUB_REPO

  if (!token || !repo) {
    return {
      success: false,
      error: "GITHUB_TOKEN or GITHUB_REPO not configured",
    }
  }
  return { success: true, config: { token, repo } }
}

// -- Response types (slim, only what we need) --

export type GitHubCommit = Readonly<{
  sha: string
  message: string
  author: string
  date: string
  url: string
}>

export type GitHubPullRequest = Readonly<{
  number: number
  title: string
  state: string
  author: string
  createdAt: string
  updatedAt: string
  url: string
  draft: boolean
  labels: ReadonlyArray<string>
}>

export type GitHubIssue = Readonly<{
  number: number
  title: string
  state: string
  author: string
  createdAt: string
  updatedAt: string
  url: string
  labels: ReadonlyArray<string>
  assignees: ReadonlyArray<string>
}>

export type GitHubContributor = Readonly<{
  login: string
  contributions: number
  avatarUrl: string
  url: string
}>

export type GitHubMilestone = Readonly<{
  number: number
  title: string
  state: string
  description: string | null
  openIssues: number
  closedIssues: number
  dueOn: string | null
  url: string
}>

export type GitHubRepoStats = Readonly<{
  name: string
  fullName: string
  description: string | null
  stars: number
  forks: number
  openIssues: number
  watchers: number
  defaultBranch: string
  language: string | null
  updatedAt: string
}>

export type CreatedIssue = Readonly<{
  number: number
  title: string
  url: string
}>

export type GitHubFileDiff = Readonly<{
  filename: string
  status: string
  additions: number
  deletions: number
  patch: string | null
}>

export type GitHubCommitDiff = Readonly<{
  sha: string
  message: string
  author: string
  date: string
  stats: { additions: number; deletions: number; total: number }
  files: ReadonlyArray<GitHubFileDiff>
}>

// -- Result type --

type Ok<T> = { readonly success: true; readonly data: T }
type Err = { readonly success: false; readonly error: string }
type Result<T> = Ok<T> | Err

// -- Internal helpers --

function headers(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "User-Agent": USER_AGENT,
  }
}

async function ghFetch<T>(
  token: string,
  path: string,
  init?: RequestInit,
): Promise<Result<T>> {
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: { ...headers(token), ...init?.headers },
    })
    if (!res.ok) {
      const body = await res.text().catch(() => "")
      return {
        success: false,
        error: `GitHub API ${res.status}: ${body.slice(0, 200)}`,
      }
    }
    const data = (await res.json()) as T
    return { success: true, data }
  } catch (err) {
    return {
      success: false,
      error: `GitHub API error: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
}

// -- Raw response shapes (only fields we map) --

type RawCommit = {
  sha: string
  html_url: string
  commit: {
    message: string
    author: { name: string; date: string }
  }
}

type RawPR = {
  number: number
  title: string
  state: string
  user: { login: string }
  created_at: string
  updated_at: string
  html_url: string
  draft: boolean
  labels: ReadonlyArray<{ name: string }>
}

type RawIssue = {
  number: number
  title: string
  state: string
  user: { login: string }
  created_at: string
  updated_at: string
  html_url: string
  labels: ReadonlyArray<{ name: string }>
  assignees: ReadonlyArray<{ login: string }>
  pull_request?: unknown
}

type RawContributor = {
  login: string
  contributions: number
  avatar_url: string
  html_url: string
}

type RawMilestone = {
  number: number
  title: string
  state: string
  description: string | null
  open_issues: number
  closed_issues: number
  due_on: string | null
  html_url: string
}

type RawRepo = {
  name: string
  full_name: string
  description: string | null
  stargazers_count: number
  forks_count: number
  open_issues_count: number
  subscribers_count: number
  default_branch: string
  language: string | null
  updated_at: string
}

type RawCommitDetail = {
  sha: string
  html_url: string
  commit: {
    message: string
    author: { name: string; date: string }
  }
  stats: {
    additions: number
    deletions: number
    total: number
  }
  files: Array<{
    filename: string
    status: string
    additions: number
    deletions: number
    patch?: string
  }>
}

type RawCreatedIssue = {
  number: number
  title: string
  html_url: string
}

// -- Public API --

export async function fetchCommits(
  config: GitHubConfig,
  limit = 10,
): Promise<Result<ReadonlyArray<GitHubCommit>>> {
  const res = await ghFetch<ReadonlyArray<RawCommit>>(
    config.token,
    `/repos/${config.repo}/commits?per_page=${limit}`,
  )
  if (!res.success) return res
  return {
    success: true,
    data: res.data.map((c) => ({
      sha: c.sha.slice(0, 7),
      message: c.commit.message.split("\n")[0],
      author: c.commit.author.name,
      date: c.commit.author.date,
      url: c.html_url,
    })),
  }
}

export async function fetchPullRequests(
  config: GitHubConfig,
  state: "open" | "closed" | "all" = "open",
  limit = 10,
): Promise<Result<ReadonlyArray<GitHubPullRequest>>> {
  const res = await ghFetch<ReadonlyArray<RawPR>>(
    config.token,
    `/repos/${config.repo}/pulls?state=${state}&per_page=${limit}`,
  )
  if (!res.success) return res
  return {
    success: true,
    data: res.data.map((pr) => ({
      number: pr.number,
      title: pr.title,
      state: pr.state,
      author: pr.user.login,
      createdAt: pr.created_at,
      updatedAt: pr.updated_at,
      url: pr.html_url,
      draft: pr.draft,
      labels: pr.labels.map((l) => l.name),
    })),
  }
}

export async function fetchIssues(
  config: GitHubConfig,
  state: "open" | "closed" | "all" = "open",
  labels?: string,
  limit = 10,
): Promise<Result<ReadonlyArray<GitHubIssue>>> {
  let path = `/repos/${config.repo}/issues?state=${state}&per_page=${limit}`
  if (labels) path += `&labels=${encodeURIComponent(labels)}`

  const res = await ghFetch<ReadonlyArray<RawIssue>>(
    config.token,
    path,
  )
  if (!res.success) return res
  return {
    success: true,
    data: res.data
      .filter((i) => !i.pull_request)
      .map((i) => ({
        number: i.number,
        title: i.title,
        state: i.state,
        author: i.user.login,
        createdAt: i.created_at,
        updatedAt: i.updated_at,
        url: i.html_url,
        labels: i.labels.map((l) => l.name),
        assignees: i.assignees.map((a) => a.login),
      })),
  }
}

export async function fetchContributors(
  config: GitHubConfig,
): Promise<Result<ReadonlyArray<GitHubContributor>>> {
  const res = await ghFetch<ReadonlyArray<RawContributor>>(
    config.token,
    `/repos/${config.repo}/contributors?per_page=30`,
  )
  if (!res.success) return res
  return {
    success: true,
    data: res.data.map((c) => ({
      login: c.login,
      contributions: c.contributions,
      avatarUrl: c.avatar_url,
      url: c.html_url,
    })),
  }
}

export async function fetchMilestones(
  config: GitHubConfig,
  state: "open" | "closed" | "all" = "open",
): Promise<Result<ReadonlyArray<GitHubMilestone>>> {
  const res = await ghFetch<ReadonlyArray<RawMilestone>>(
    config.token,
    `/repos/${config.repo}/milestones?state=${state}&per_page=20`,
  )
  if (!res.success) return res
  return {
    success: true,
    data: res.data.map((m) => ({
      number: m.number,
      title: m.title,
      state: m.state,
      description: m.description,
      openIssues: m.open_issues,
      closedIssues: m.closed_issues,
      dueOn: m.due_on,
      url: m.html_url,
    })),
  }
}

export async function fetchRepoStats(
  config: GitHubConfig,
): Promise<Result<GitHubRepoStats>> {
  const res = await ghFetch<RawRepo>(
    config.token,
    `/repos/${config.repo}`,
  )
  if (!res.success) return res
  return {
    success: true,
    data: {
      name: res.data.name,
      fullName: res.data.full_name,
      description: res.data.description,
      stars: res.data.stargazers_count,
      forks: res.data.forks_count,
      openIssues: res.data.open_issues_count,
      watchers: res.data.subscribers_count,
      defaultBranch: res.data.default_branch,
      language: res.data.language,
      updatedAt: res.data.updated_at,
    },
  }
}

export async function createIssue(
  config: GitHubConfig,
  title: string,
  body: string,
  labels?: ReadonlyArray<string>,
  assignee?: string,
  milestone?: number,
): Promise<Result<CreatedIssue>> {
  const payload: Record<string, unknown> = { title, body }
  if (labels?.length) payload.labels = labels
  if (assignee) payload.assignee = assignee
  if (milestone) payload.milestone = milestone

  const res = await ghFetch<RawCreatedIssue>(
    config.token,
    `/repos/${config.repo}/issues`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
  )
  if (!res.success) return res
  return {
    success: true,
    data: {
      number: res.data.number,
      title: res.data.title,
      url: res.data.html_url,
    },
  }
}

async function fetchRawDiff(
  token: string,
  repo: string,
  sha: string,
): Promise<Result<string>> {
  try {
    const res = await fetch(`${API_BASE}/repos/${repo}/commits/${sha}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github.diff",
        "User-Agent": USER_AGENT,
      },
    })
    if (!res.ok) {
      const body = await res.text().catch(() => "")
      return {
        success: false,
        error: `GitHub API ${res.status}: ${body.slice(0, 200)}`,
      }
    }
    return { success: true, data: await res.text() }
  } catch (err) {
    return {
      success: false,
      error: `GitHub API error: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
}

function parseRawDiff(raw: string): Map<string, string> {
  const patches = new Map<string, string>()
  const parts = raw.split(/^diff --git /m)
  for (const part of parts) {
    if (!part.trim()) continue
    const headerMatch = part.match(/^a\/.+? b\/(.+?)[\r\n]/)
    if (!headerMatch) continue
    const filename = headerMatch[1]
    const lines = part.split("\n")
    let patchStart = -1
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith("@@")) {
        patchStart = i
        break
      }
    }
    if (patchStart >= 0) {
      patches.set(filename, lines.slice(patchStart).join("\n"))
    }
  }
  return patches
}

export async function fetchCommitDiff(
  config: GitHubConfig,
  sha: string,
): Promise<Result<GitHubCommitDiff>> {
  const res = await ghFetch<RawCommitDetail>(
    config.token,
    `/repos/${config.repo}/commits/${sha}`,
  )
  if (!res.success) return res

  let files = res.data.files.slice(0, 20).map((f) => ({
    filename: f.filename,
    status: f.status,
    additions: f.additions,
    deletions: f.deletions,
    patch: f.patch?.slice(0, 5000) ?? null,
  }))

  const hasMissingPatches = files.some(
    (f) => f.patch === null && (f.additions > 0 || f.deletions > 0),
  )
  if (hasMissingPatches) {
    const rawRes = await fetchRawDiff(
      config.token,
      config.repo,
      sha,
    )
    if (rawRes.success) {
      const parsed = parseRawDiff(rawRes.data)
      files = files.map((f) => ({
        ...f,
        patch:
          f.patch ??
          (parsed.get(f.filename)?.slice(0, 5000) ?? null),
      }))
    }
  }

  return {
    success: true,
    data: {
      sha: res.data.sha.slice(0, 7),
      message: res.data.commit.message.split("\n")[0],
      author: res.data.commit.author.name,
      date: res.data.commit.author.date,
      stats: res.data.stats,
      files,
    },
  }
}
