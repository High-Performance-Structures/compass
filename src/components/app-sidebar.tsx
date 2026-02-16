"use client"

import * as React from "react"
import {
  IconAddressBook,
  IconCalendarStats,
  IconFiles,
  IconFolder,
  IconMessageCircle,
  IconReceipt,
  IconSettings,
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

const data = {
  navMain: [
    {
      title: "Projects",
      url: "/dashboard/projects",
      icon: IconFolder,
    },
    {
      title: "Schedule",
      url: "/dashboard/projects/demo-project-1/schedule",
      icon: IconCalendarStats,
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
  ],
  navSecondary: [
    {
      title: "Settings",
      url: "/dashboard/settings",
      icon: IconSettings,
    },
  ],
}

function SidebarNav({
  projects,
  dashboards = [],
}: {
  projects: { id: string; name: string }[]
  dashboards?: ReadonlyArray<{
    readonly id: string
    readonly name: string
  }>
}) {
  const pathname = usePathname()
  const { state, setOpen } = useSidebar()
  const isExpanded = state === "expanded"
  const isFilesMode = pathname?.startsWith("/dashboard/files")
  const isConversationsMode = pathname?.startsWith("/dashboard/conversations")
  const isProjectMode = /^\/dashboard\/projects\/[^/]+/.test(
    pathname ?? ""
  )

  // Allow manual collapse/expand in all modes
  // React.useEffect(() => {
  //   if ((isFilesMode || isProjectMode) && !isExpanded) {
  //     setOpen(true)
  //   }
  // }, [isFilesMode, isProjectMode, isExpanded, setOpen])

  const showContext = isExpanded && (isFilesMode || isProjectMode || isConversationsMode)

  const mode = showContext && isFilesMode
    ? "files"
    : showContext && isConversationsMode
      ? "conversations"
      : showContext && isProjectMode
        ? "projects"
        : "main"

  const secondaryItems = [...data.navSecondary]

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
          <NavMain items={data.navMain} />
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
  readonly projects?: ReadonlyArray<{ readonly id: string; readonly name: string }>
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
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              className="data-[slot=sidebar-menu-button]:!p-1.5"
            >
              <a href="/dashboard">
                <span
                  aria-label="Compass"
                  className="!size-5 shrink-0 block bg-current"
                  style={{
                    maskImage: "url(/logo-black.png)",
                    maskSize: "contain",
                    maskRepeat: "no-repeat",
                    WebkitMaskImage: "url(/logo-black.png)",
                    WebkitMaskSize: "contain",
                    WebkitMaskRepeat: "no-repeat",
                  }}
                />
                <span className="text-base font-semibold">
                  COMPASS
                </span>
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <OrgSwitcher activeOrgId={activeOrgId} activeOrgName={activeOrgName} />
      </SidebarHeader>
      <SidebarContent>
        <SidebarNav
          projects={projects as { id: string; name: string }[]}
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
