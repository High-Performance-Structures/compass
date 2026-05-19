"use client"

import * as React from "react"
import {
  IconAddressBook,
  IconAutomation,
  IconCalendarStats,
  IconClipboardText,
  IconFiles,
  IconFileDollar,
  IconFolder,
  IconHome2,
  IconMailForward,
  IconMessageCircle,
  IconMessageCircleQuestion,
  IconPhoto,
  IconReceipt,
  IconSettings,
  IconShoppingCart,
} from "@tabler/icons-react"
import { usePathname } from "next/navigation"

import { NavMain } from "@/components/nav-main"
import { NavDashboards } from "@/components/nav-dashboards"
import { NavSecondary } from "@/components/nav-secondary"
import { NavFiles } from "@/components/nav-files"
import { NavProjects } from "@/components/nav-projects"
import { NavConversations } from "@/components/nav-conversations"
import { NavUser } from "@/components/nav-user"
import { OrgSwitcher } from "@/components/org-switcher"
import { VoicePanel } from "@/components/voice/voice-panel"
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

const NAV_MAIN = [
  {
    title: "Dashboard",
    url: "/dashboard",
    icon: IconHome2,
  },
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
    url: "/dashboard/projects",
    icon: IconMessageCircleQuestion,
    projectPath: "",
  },
  {
    title: "Conversations",
    url: "/dashboard/conversations",
    icon: IconMessageCircle,
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
    url: "/dashboard/financials",
    icon: IconShoppingCart,
  },
]

const NAV_SECONDARY = [
  {
    title: "Automations",
    url: "/dashboard/automations",
    icon: IconAutomation,
  },
  {
    title: "Settings",
    url: "/dashboard/settings",
    icon: IconSettings,
  },
]

function SidebarNav({
  projects,
  dashboards = [],
}: {
  projects: ReadonlyArray<ProjectListItem>
  dashboards?: ReadonlyArray<{
    readonly id: string
    readonly name: string
  }>
}) {
  const pathname = usePathname()
  const { state } = useSidebar()
  const isExpanded = state === "expanded"
  const isFilesMode = pathname?.startsWith("/dashboard/files")
  const isConversationsMode = pathname?.startsWith("/dashboard/conversations")
  const isProjectMode = /^\/dashboard\/projects\/[^/]+/.test(
    pathname ?? ""
  )

  const showContext = isExpanded && (isFilesMode || isProjectMode || isConversationsMode)

  const mode = showContext && isFilesMode
    ? "files"
    : showContext && isConversationsMode
      ? "conversations"
      : showContext && isProjectMode
        ? "projects"
        : "main"

  const firstProjectId = projects[0]?.id
  const navMain = NAV_MAIN.map((item) =>
    "projectPath" in item && firstProjectId
      ? { ...item, url: `/dashboard/projects/${firstProjectId}${item.projectPath}` }
      : item
  )
  const secondaryItems = [...NAV_SECONDARY]

  return (
    <div key={mode} className="animate-in fade-in slide-in-from-left-1 flex flex-1 flex-col duration-150">
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
        <>
          <NavMain items={navMain} />
          <NavDashboards dashboards={dashboards} />
          <NavSecondary items={secondaryItems} className="mt-auto" />
        </>
      )}
    </div>
  )
}

export function AppSidebar({
  projects = [],
  dashboards = [],
  user,
  activeOrgId = null,
  activeOrgName = null,
  ...props
}: React.ComponentProps<typeof Sidebar> & {
  readonly projects?: ReadonlyArray<ProjectListItem>
  readonly dashboards?: ReadonlyArray<{ readonly id: string; readonly name: string }>
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
      <SidebarContent>
        <SidebarNav
          projects={projects}
          dashboards={dashboards}
        />
      </SidebarContent>
      <SidebarFooter>
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
        <NavUser user={user} />
      </SidebarFooter>
    </Sidebar>
  )
}
