"use client"

import * as React from "react"
import {
  IconArrowLeft,
  IconHash,
  IconPlus,
} from "@tabler/icons-react"
import Link from "next/link"
import { usePathname } from "next/navigation"

import { listChannels } from "@/app/actions/conversations"
import { listCategories } from "@/app/actions/channel-categories"
import { getProjects, type ProjectListItem } from "@/app/actions/projects"
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { CreateChannelDialog } from "@/components/conversations/create-channel-dialog"
import { VoiceChannelStub } from "@/components/conversations/voice-channel-stub"
import { ChevronRight } from "lucide-react"

type ChannelData = {
  readonly id: string
  readonly name: string
  readonly type: string
  readonly projectId: string | null
  readonly categoryId: string | null
  readonly unreadCount: number | null
}

type CategoryData = {
  readonly id: string
  readonly name: string
  readonly position: number
  readonly channelCount: number
}

function getCategoryCollapsedState(id: string): boolean {
  if (typeof window === "undefined") return false
  const stored = localStorage.getItem(`compass-category-${id}-collapsed`)
  return stored === "true"
}

function setCategoryCollapsedState(id: string, collapsed: boolean): void {
  if (typeof window === "undefined") return
  localStorage.setItem(`compass-category-${id}-collapsed`, String(collapsed))
}

export function NavConversations() {
  const pathname = usePathname()
  const { state } = useSidebar()
  const isExpanded = state === "expanded"
  const [channels, setChannels] = React.useState<ChannelData[]>([])
  const [categories, setCategories] = React.useState<CategoryData[]>([])
  const [projects, setProjects] = React.useState<ProjectListItem[]>([])
  const [loading, setLoading] = React.useState(true)
  const [createDialogOpen, setCreateDialogOpen] = React.useState(false)
  const [projectsOpen, setProjectsOpen] = React.useState(true)
  const [categoryCollapsedStates, setCategoryCollapsedStates] = React.useState<
    Record<string, boolean>
  >({})

  // load collapsed states from localStorage after mount
  React.useEffect(() => {
    const states: Record<string, boolean> = {}
    categories.forEach((cat) => {
      states[cat.id] = getCategoryCollapsedState(cat.id)
    })
    setCategoryCollapsedStates(states)
  }, [categories])

  React.useEffect(() => {
    async function loadData() {
      const [channelsResult, categoriesResult, projectRows] = await Promise.all([
        listChannels(),
        listCategories(),
        getProjects(),
      ])

      if (channelsResult.success && channelsResult.data) {
        setChannels(
          channelsResult.data.map((c) => ({
            id: c.id,
            name: c.name,
            type: c.type,
            projectId: c.projectId,
            categoryId: c.categoryId,
            unreadCount: c.unreadCount,
          }))
        )
      }

      if (categoriesResult.success && categoriesResult.data) {
        setCategories(
          categoriesResult.data.map((cat) => ({
            id: cat.id,
            name: cat.name,
            position: cat.position,
            channelCount: cat.channelCount,
          }))
        )
      }

      setProjects([...projectRows])

      setLoading(false)
    }
    loadData()
  }, [])

  const globalChannels = channels.filter(
    (c) => !c.projectId && !c.categoryId && c.type === "text"
  )
  const projectChannels = channels.filter((c) => c.projectId && c.type === "text")
  const voiceChannels = channels.filter((c) => c.type === "voice")
  const projectChannelsByProject = React.useMemo(() => {
    const projectById = new Map(projects.map((project) => [project.id, project]))
    const grouped = new Map<string, ChannelData[]>()
    const orphanChannels: ChannelData[] = []

    for (const channel of projectChannels) {
      if (!channel.projectId || !projectById.has(channel.projectId)) {
        orphanChannels.push(channel)
        continue
      }
      const existing = grouped.get(channel.projectId) ?? []
      existing.push(channel)
      grouped.set(channel.projectId, existing)
    }

    const projectGroups = projects
      .map((project) => ({
        project,
        channels: grouped.get(project.id) ?? [],
      }))
      .filter((group) => group.channels.length > 0)

    return { projectGroups, orphanChannels }
  }, [projectChannels, projects])

  // group channels by category (only non-project text channels)
  const channelsByCategory = React.useMemo(() => {
    const grouped = new Map<string | null, ChannelData[]>()
    categories.forEach((cat) => grouped.set(cat.id, []))
    grouped.set(null, [])

    channels.forEach((channel) => {
      if (!channel.projectId && channel.type === "text") {
        const catId = channel.categoryId
        const existing = grouped.get(catId) ?? []
        grouped.set(catId, [...existing, channel])
      }
    })

    return grouped
  }, [channels, categories])

  const toggleCategory = (categoryId: string) => {
    setCategoryCollapsedStates((prev) => {
      const newState = !prev[categoryId]
      setCategoryCollapsedState(categoryId, newState)
      return { ...prev, [categoryId]: newState }
    })
  }

  const renderChannelItem = (channel: ChannelData) => (
    <SidebarMenuItem key={channel.id}>
      <SidebarMenuButton
        asChild
        tooltip={channel.name}
        className={cn(
          pathname === `/dashboard/conversations/${channel.id}` &&
            "bg-sidebar-foreground/10 font-medium"
        )}
      >
        <Link href={`/dashboard/conversations/${channel.id}`}>
          <IconHash className="shrink-0" />
          <span className={cn(channel.unreadCount && channel.unreadCount > 0 && "font-semibold")}>
            {channel.name}
          </span>
          {channel.unreadCount && channel.unreadCount > 0 && (
            <span className="ml-auto flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
              {channel.unreadCount}
            </span>
          )}
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  )

  const renderProjectLabel = (project: ProjectListItem) => (
    <SidebarMenuItem key={`project-label-${project.id}`}>
      <div className="px-2 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-sidebar-foreground/60">
        <span className="block truncate">
          {project.projectNumber ?? project.name}
        </span>
        {project.projectNumber && (
          <span className="block truncate normal-case tracking-normal text-sidebar-foreground/45">
            {project.name}
          </span>
        )}
      </div>
    </SidebarMenuItem>
  )

  return (
    <>
      <SidebarGroup>
        <SidebarGroupContent>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton asChild tooltip="Back to Dashboard">
                <Link href="/dashboard">
                  <IconArrowLeft />
                  <span>Back</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>

      {/* uncategorized channels */}
      <SidebarGroup>
        <SidebarGroupLabel>CHANNELS</SidebarGroupLabel>
        <SidebarGroupContent>
          <SidebarMenu>
            {loading ? (
              <SidebarMenuItem>
                <span className="px-2 text-xs text-muted-foreground">Loading...</span>
              </SidebarMenuItem>
            ) : globalChannels.length === 0 ? (
              <SidebarMenuItem>
                <span className="px-2 text-xs text-muted-foreground">No channels</span>
              </SidebarMenuItem>
            ) : (
              globalChannels.map(renderChannelItem)
            )}
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>

      {/* categories with their channels */}
      {categories.map((category) => {
        const categoryChannels = channelsByCategory.get(category.id) ?? []
        if (categoryChannels.length === 0) return null

        const isCollapsed = categoryCollapsedStates[category.id] ?? false

        return (
          <Collapsible
            key={category.id}
            open={!isCollapsed}
            onOpenChange={() => toggleCategory(category.id)}
          >
            <SidebarGroup>
              <SidebarGroupLabel asChild>
                <CollapsibleTrigger className="group/collapsible">
                  {category.name.toUpperCase()}
                  <span className="ml-1 text-muted-foreground">
                    ({categoryChannels.length})
                  </span>
                  <ChevronRight className="ml-auto transition-transform group-data-[state=open]/collapsible:rotate-90" />
                </CollapsibleTrigger>
              </SidebarGroupLabel>
              <CollapsibleContent>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {categoryChannels.map(renderChannelItem)}
                  </SidebarMenu>
                </SidebarGroupContent>
              </CollapsibleContent>
            </SidebarGroup>
          </Collapsible>
        )
      })}

      {/* project channels */}
      {projectChannels.length > 0 && (
        <Collapsible open={projectsOpen} onOpenChange={setProjectsOpen}>
          <SidebarGroup>
            <SidebarGroupLabel asChild>
              <CollapsibleTrigger className="group/collapsible">
                PROJECT CHANNELS
                <ChevronRight className="ml-auto transition-transform group-data-[state=open]/collapsible:rotate-90" />
              </CollapsibleTrigger>
            </SidebarGroupLabel>
            <CollapsibleContent>
              <SidebarGroupContent>
                <SidebarMenu>
                  {projectChannelsByProject.projectGroups.map((group) => (
                    <React.Fragment key={group.project.id}>
                      {renderProjectLabel(group.project)}
                      {group.channels.map(renderChannelItem)}
                    </React.Fragment>
                  ))}
                  {projectChannelsByProject.orphanChannels.length > 0 && (
                    <>
                      <SidebarMenuItem>
                        <div className="px-2 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-sidebar-foreground/60">
                          Unmapped
                        </div>
                      </SidebarMenuItem>
                      {projectChannelsByProject.orphanChannels.map(renderChannelItem)}
                    </>
                  )}
                </SidebarMenu>
              </SidebarGroupContent>
            </CollapsibleContent>
          </SidebarGroup>
        </Collapsible>
      )}

      {/* voice channels */}
      {voiceChannels.length > 0 && (
        <SidebarGroup>
          <SidebarGroupLabel>VOICE CHANNELS</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {voiceChannels.map((channel) => (
                <SidebarMenuItem key={channel.id}>
                  <VoiceChannelStub id={channel.id} name={channel.name} />
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      )}

      <div className="mt-auto flex gap-2 px-3 pb-3">
        <Button
          variant="outline"
          size="sm"
          className="flex-1 border-sidebar-border bg-sidebar-accent text-sidebar-accent-foreground shadow-none hover:bg-sidebar-accent/80 hover:text-sidebar-accent-foreground focus-visible:ring-sidebar-ring/60"
          onClick={() => setCreateDialogOpen(true)}
        >
          <IconPlus className="h-4 w-4" />
          {isExpanded && <span className="ml-2">New</span>}
        </Button>
      </div>

      <CreateChannelDialog open={createDialogOpen} onOpenChange={setCreateDialogOpen} />
    </>
  )
}
