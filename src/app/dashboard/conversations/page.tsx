import Link from "next/link"
import { FolderOpen, Hash, MessageSquare } from "lucide-react"
import { listChannels } from "@/app/actions/conversations"
import { getProjects } from "@/app/actions/projects"
import { CreateChannelButton } from "@/components/conversations/create-channel-button"
import { ProjectConversationLauncher } from "@/components/conversations/project-conversation-launcher"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

export default async function ConversationsPage() {
  const [result, projects] = await Promise.all([listChannels(), getProjects()])
  const channels = result.success && result.data ? result.data : []
  const companyChannels = channels.filter(
    (channel) => !channel.projectId && channel.type === "text"
  )
  const projectChannels = channels.filter(
    (channel) => channel.projectId && channel.type === "text"
  )

  const firstCompanyChannel = companyChannels[0] ?? null
  const recentProjectChannels = projectChannels.slice(0, 8)

  return (
    <div className="flex h-full flex-1 flex-col overflow-y-auto p-4 sm:p-6">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-medium uppercase text-muted-foreground">
            Conversations
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">
            Staff messages and project conversations
          </h1>
        </div>
        <CreateChannelButton />
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(280px,360px)]">
        <section className="space-y-3 border-y py-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <MessageSquare className="size-5 text-muted-foreground" />
              <h2 className="text-sm font-semibold">Company Channels</h2>
            </div>
            <Badge variant="outline">{companyChannels.length}</Badge>
          </div>

          {companyChannels.length > 0 ? (
            <div className="divide-y border-y">
              {companyChannels.map((channel) => (
                <Link
                  key={channel.id}
                  href={`/dashboard/conversations/${channel.id}`}
                  className="flex items-center justify-between gap-3 py-3 transition-colors hover:text-primary"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <Hash className="size-4 shrink-0 text-muted-foreground" />
                    <span className="truncate font-medium">{channel.name}</span>
                  </span>
                  {channel.unreadCount && channel.unreadCount > 0 ? (
                    <span className="rounded-full bg-primary px-2 py-0.5 text-xs font-semibold text-primary-foreground">
                      {channel.unreadCount}
                    </span>
                  ) : null}
                </Link>
              ))}
            </div>
          ) : (
            <div className="flex min-h-36 flex-col items-center justify-center border-y py-8 text-center">
              <MessageSquare className="mb-3 size-10 text-muted-foreground/40" />
              <p className="font-medium">No company channels yet</p>
              <p className="mt-1 max-w-md text-sm text-muted-foreground">
                Create a channel for office-wide or department conversations.
              </p>
            </div>
          )}

          {firstCompanyChannel && (
            <Button asChild variant="outline" size="sm">
              <Link href={`/dashboard/conversations/${firstCompanyChannel.id}`}>
                Open first company channel
              </Link>
            </Button>
          )}
        </section>

        <aside className="space-y-4 border-y py-4 lg:border-l lg:border-y-0 lg:py-0 lg:pl-4">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <FolderOpen className="size-5 text-muted-foreground" />
              <h2 className="text-sm font-semibold">Project Conversations</h2>
            </div>
            <ProjectConversationLauncher projects={projects} />
          </div>

          {recentProjectChannels.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium uppercase text-muted-foreground">
                Recent project channels
              </p>
              <div className="divide-y border-y">
                {recentProjectChannels.map((channel) => (
                  <Link
                    key={channel.id}
                    href={`/dashboard/conversations/${channel.id}`}
                    className="flex items-center justify-between gap-3 py-2.5 text-sm transition-colors hover:text-primary"
                  >
                    <span className="min-w-0 truncate">#{channel.name}</span>
                    {channel.unreadCount && channel.unreadCount > 0 ? (
                      <span className="rounded-full bg-primary px-2 py-0.5 text-[11px] font-semibold text-primary-foreground">
                        {channel.unreadCount}
                      </span>
                    ) : null}
                  </Link>
                ))}
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}
