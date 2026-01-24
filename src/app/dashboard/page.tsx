export const dynamic = "force-dynamic"

import { FeedbackCallout } from "@/components/feedback-widget"
import {
  IconBrandGithub,
  IconExternalLink,
  IconGitCommit,
  IconGitFork,
  IconStar,
  IconAlertCircle,
  IconEye,
} from "@tabler/icons-react"

const REPO = "High-Performance-Structures/compass"
const GITHUB_URL = `https://github.com/${REPO}`

type RepoStats = {
  stargazers_count: number
  forks_count: number
  open_issues_count: number
  subscribers_count: number
}

type Commit = {
  sha: string
  commit: {
    message: string
    author: { name: string; date: string }
  }
  html_url: string
}

async function getRepoData() {
  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare")
    const { env } = await getCloudflareContext()
    const token = (env as unknown as Record<string, unknown>).GITHUB_TOKEN as string | undefined

    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "User-Agent": "compass-dashboard",
    }
    if (token) headers.Authorization = `Bearer ${token}`

    const [repoRes, commitsRes] = await Promise.all([
      fetch(`https://api.github.com/repos/${REPO}`, {
        next: { revalidate: 300 },
        headers,
      }),
      fetch(`https://api.github.com/repos/${REPO}/commits?per_page=8`, {
        next: { revalidate: 300 },
        headers,
      }),
    ])

    if (!repoRes.ok || !commitsRes.ok) return null

    const repo: RepoStats = await repoRes.json()
    const commits: Commit[] = await commitsRes.json()
    return { repo, commits }
  } catch {
    return null
  }
}

function timeAgo(date: string) {
  const seconds = Math.floor(
    (Date.now() - new Date(date).getTime()) / 1000
  )
  if (seconds < 60) return "just now"
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  return new Date(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  })
}

export default async function Page() {
  const data = await getRepoData()

  return (
    <div className="flex flex-1 items-start justify-center p-4 sm:p-6 md:p-12">
      <div className="w-full max-w-6xl py-4 sm:py-8">
        <div className="mb-10 text-center">
          <span
            className="mx-auto mb-3 block size-12 bg-foreground"
            style={{
              maskImage: "url(/logo-black.png)",
              maskSize: "contain",
              maskRepeat: "no-repeat",
              WebkitMaskImage: "url(/logo-black.png)",
              WebkitMaskSize: "contain",
              WebkitMaskRepeat: "no-repeat",
            }}
          />
          <h1 className="text-3xl font-bold tracking-tight">
            Compass
          </h1>
          <p className="text-muted-foreground mt-2">
            Development preview — features may be incomplete
            or change without notice.
          </p>
          <div className="mt-4">
            <FeedbackCallout />
          </div>
        </div>

        <div className="grid gap-10 lg:grid-cols-2">
          <div className="space-y-8 text-sm leading-relaxed">
            <section>
              <h2 className="mb-3 text-base font-semibold flex items-center gap-2">
                <span className="inline-block size-2 rounded-full bg-green-500" />
                Working
              </h2>
              <ul className="space-y-1.5 pl-4">
                <li>Projects — create and manage projects with D1 database</li>
                <li>Schedule — Gantt chart with phases, tasks, dependencies, and critical path</li>
                <li>File browser — drive-style UI with folder navigation</li>
                <li>Settings — app preferences with theme and notifications</li>
                <li>Sidebar navigation with contextual project/file views</li>
                <li>Command palette search (Cmd+K)</li>
              </ul>
            </section>

            <section>
              <h2 className="mb-3 text-base font-semibold flex items-center gap-2">
                <span className="inline-block size-2 rounded-full bg-yellow-500" />
                In Progress
              </h2>
              <ul className="space-y-1.5 pl-4">
                <li>Project auto-provisioning (code generation, CSI folder structure)</li>
                <li>Budget tracking (CSI divisions, estimated vs actual, change orders)</li>
                <li>Document management (S3/R2 storage, metadata, versioning)</li>
                <li>Communication logging (manual entries, timeline view)</li>
                <li>Dashboard — three-column layout (past due, due today, action items)</li>
                <li>User authentication and roles (WorkOS)</li>
                <li>Email notifications (Resend)</li>
                <li>Basic reports (budget variance, overdue tasks, monthly actuals)</li>
              </ul>
            </section>

            <section>
              <h2 className="mb-3 text-base font-semibold flex items-center gap-2">
                <span className="inline-block size-2 rounded-full bg-muted-foreground/50" />
                Planned
              </h2>
              <ul className="space-y-1.5 pl-4 text-muted-foreground">
                <li>Client portal with read-only views</li>
                <li>BuilderTrend import wizard (CSV-based)</li>
                <li>Daily logs</li>
                <li>Time tracking</li>
                <li>Report builder (custom fields and filters)</li>
                <li>Bid package management</li>
              </ul>
            </section>

            <section>
              <h2 className="mb-3 text-base font-semibold flex items-center gap-2">
                <span className="inline-block size-2 rounded-full bg-muted-foreground/30" />
                Future
              </h2>
              <ul className="space-y-1.5 pl-4 text-muted-foreground">
                <li>Netsuite/QuickBooks API sync</li>
                <li>Payment integration</li>
                <li>RFI/Submittal tracking</li>
                <li>Native mobile apps (iOS/Android)</li>
                <li>Advanced scheduling (resource leveling, baseline comparison)</li>
              </ul>
            </section>

          </div>

          {data && (
            <div className="lg:sticky lg:top-6 lg:self-start space-y-6">
              <a
                href={GITHUB_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:bg-muted/50 border rounded-lg px-4 py-3 flex items-center gap-3 transition-colors"
              >
                <IconBrandGithub className="size-5 shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-medium">View on GitHub</p>
                  <p className="text-muted-foreground text-xs truncate">{REPO}</p>
                </div>
                <IconExternalLink className="text-muted-foreground size-3.5 shrink-0 ml-auto" />
              </a>
              <div className="grid grid-cols-2 gap-3">
                <StatCard
                  icon={<IconStar className="size-4" />}
                  label="Stars"
                  value={data.repo.stargazers_count}
                />
                <StatCard
                  icon={<IconGitFork className="size-4" />}
                  label="Forks"
                  value={data.repo.forks_count}
                />
                <StatCard
                  icon={<IconAlertCircle className="size-4" />}
                  label="Issues"
                  value={data.repo.open_issues_count}
                />
                <StatCard
                  icon={<IconEye className="size-4" />}
                  label="Watchers"
                  value={data.repo.subscribers_count}
                />
              </div>

              <div>
                <h2 className="text-muted-foreground mb-3 text-xs font-medium uppercase tracking-wider">
                  Recent Commits
                </h2>
                <div className="border rounded-lg divide-y">
                  {data.commits.map((commit) => (
                    <a
                      key={commit.sha}
                      href={commit.html_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:bg-muted/50 flex items-start gap-3 px-4 py-3 transition-colors"
                    >
                      <IconGitCommit className="text-muted-foreground mt-0.5 size-4 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm">
                          {commit.commit.message.split("\n")[0]}
                        </p>
                        <p className="text-muted-foreground mt-0.5 text-xs">
                          {commit.commit.author.name}
                          <span className="mx-1.5">·</span>
                          {timeAgo(commit.commit.author.date)}
                        </p>
                      </div>
                      <code className="text-muted-foreground shrink-0 font-mono text-xs">
                        {commit.sha.slice(0, 7)}
                      </code>
                    </a>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function StatCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode
  label: string
  value: number
}) {
  return (
    <div className="border rounded-lg px-4 py-3">
      <div className="text-muted-foreground mb-1 flex items-center gap-1.5 text-xs">
        {icon}
        {label}
      </div>
      <p className="text-2xl font-semibold tabular-nums">
        {value.toLocaleString()}
      </p>
    </div>
  )
}
