"use client"

import * as React from "react"
import {
  IconAddressBook,
  IconCalendarStats,
  IconClipboardCheck,
  IconClipboardText,
  IconFiles,
  IconFileDollar,
  IconFolder,
  IconHome2,
  IconMailForward,
  IconMessageCircle,
  IconMessageCircleQuestion,
  IconMessageReport,
  IconPalette,
  IconPhoto,
  IconReceipt,
  IconShoppingCart,
  IconShoppingCartQuestion,
} from "@tabler/icons-react"
import { usePathname } from "next/navigation"

import { NavMain } from "@/components/nav-main"
import { NavFiles } from "@/components/nav-files"
import { NavProjects } from "@/components/nav-projects"
import { NavConversations } from "@/components/nav-conversations"
import { NavUser } from "@/components/nav-user"
import { OrgSwitcher } from "@/components/org-switcher"
import { PersonalDeskPhoto } from "@/components/personal-desk-photo"
import { VoicePanel } from "@/components/voice/voice-panel"
import { useActiveProject } from "@/components/project-list-provider"
// settings is now a page at /dashboard/settings
import { openFeedbackDialog } from "@/components/feedback-widget"
import { useVoiceState } from "@/hooks/use-voice-state"
import type { ProjectListItem } from "@/app/actions/projects"
import type { SidebarUser } from "@/lib/auth"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"

const PERSISTENT_NAV = [
  {
    title: "Dashboard",
    url: "/dashboard",
    icon: IconHome2,
  },
  {
    title: "To-Dos",
    url: "/dashboard/schedule?kind=task",
    icon: IconClipboardCheck,
  },
]

const NAV_MAIN = [
  {
    title: "Projects",
    url: "/dashboard/projects",
    icon: IconFolder,
  },
  {
    title: "Work Calendar",
    url: "/dashboard/schedule",
    icon: IconCalendarStats,
  },
  {
    title: "Owner Updates",
    url: "/dashboard/projects",
    icon: IconMailForward,
    projectPath: "/owner-updates",
  },
  {
    title: "Daily Logs",
    url: "/dashboard/projects",
    icon: IconClipboardText,
    projectPath: "/daily-logs",
  },
  {
    title: "Photos",
    url: "/dashboard/projects",
    icon: IconPhoto,
    projectPath: "/photos",
  },
  {
    title: "Selections",
    url: "/dashboard/projects",
    icon: IconPalette,
    projectPath: "/selections",
  },
  {
    title: "Budget",
    url: "/dashboard/projects",
    icon: IconFileDollar,
    projectPath: "/budget",
  },
  {
    title: "Project Contacts",
    url: "/dashboard/projects",
    icon: IconAddressBook,
    projectPath: "/contacts",
  },
  {
    title: "RFIs",
    url: "/dashboard/rfis",
    icon: IconMessageCircleQuestion,
  },
  {
    title: "RFQs",
    url: "/dashboard/projects",
    icon: IconShoppingCartQuestion,
    projectPath: "/rfqs",
  },
  {
    title: "Conversations",
    url: "/dashboard/conversations",
    icon: IconMessageCircle,
  },
  {
    title: "My Requests",
    url: "/dashboard/requests",
    icon: IconMessageReport,
  },
  {
    title: "Files",
    url: "/dashboard/files",
    icon: IconFiles,
  },
  {
    title: "Contacts",
    url: "/dashboard/contacts",
    icon: IconAddressBook,
  },
  {
    title: "Financials",
    url: "/dashboard/financials",
    icon: IconReceipt,
  },
  {
    title: "Purchase Orders",
    url: "/dashboard/purchase-orders",
    icon: IconShoppingCart,
  },
]

function SidebarNav({
  projects,
}: {
  projects: ReadonlyArray<ProjectListItem>
}) {
  const pathname = usePathname()
  const { state } = useSidebar()
  const isExpanded = state === "expanded"
  const { activeProjectId } = useActiveProject()
  const isFilesMode = pathname?.startsWith("/dashboard/files")
  const isConversationsMode = pathname?.startsWith("/dashboard/conversations")
  const projectPathMatch = pathname?.match(/^\/dashboard\/projects\/([^/]+)/)
  const isProjectMode =
    projectPathMatch !== null &&
    projectPathMatch !== undefined &&
    projectPathMatch[1] !== "select"

  const showContext = isExpanded && (isFilesMode || isProjectMode || isConversationsMode)

  const mode = showContext && isFilesMode
    ? "files"
    : showContext && isConversationsMode
      ? "conversations"
      : showContext && isProjectMode
        ? "projects"
        : "main"

  const navMain = NAV_MAIN.map((item) =>
    typeof item.projectPath === "string"
      ? {
          ...item,
          url: activeProjectId
            ? `/dashboard/projects/${activeProjectId}${item.projectPath}`
            : `/dashboard/projects/select?target=${encodeURIComponent(
                item.projectPath.replace(/^\//, "")
              )}`,
        }
      : item
  )

  return (
    <div key={mode} className="animate-in fade-in slide-in-from-left-1 flex flex-1 flex-col duration-150">
      <NavMain items={PERSISTENT_NAV} />
      {mode === "files" && (
        <React.Suspense>
          <NavFiles />
        </React.Suspense>
      )}
      {mode === "conversations" && (
        <React.Suspense>
          <NavConversations />
        </React.Suspense>
      )}
      {mode === "projects" && <NavProjects projects={projects} />}
      {mode === "main" && (
        <NavMain items={navMain} />
      )}
    </div>
  )
}

export function AppSidebar({
  projects = [],
  user,
  activeOrgId = null,
  activeOrgName = null,
  ...props
}: React.ComponentProps<typeof Sidebar> & {
  readonly projects?: ReadonlyArray<ProjectListItem>
  readonly user: SidebarUser | null
  readonly activeOrgId?: string | null
  readonly activeOrgName?: string | null
}) {
  const { isMobile } = useSidebar()
  const { channelId } = useVoiceState()

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <OrgSwitcher activeOrgId={activeOrgId} activeOrgName={activeOrgName} />
      </SidebarHeader>
      <SidebarContent className="compass-sidebar-scroll">
        <SidebarNav projects={projects} />
      </SidebarContent>
      <SidebarFooter className="border-t border-sidebar-border/60">
        {isMobile && (
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                onClick={openFeedbackDialog}
              >
                <IconMessageCircle />
                <span>Feedback</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        )}
        {channelId !== null && <VoicePanel />}
        <PersonalDeskPhoto user={user} />
        <NavUser user={user} />
      </SidebarFooter>
    </Sidebar>
  )
}
