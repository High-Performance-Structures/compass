"use client"

import * as React from "react"
import {
  IconAddressBook,
  IconCalendarStats,
  IconDashboard,
  IconFiles,
  IconFolder,
  IconHelp,
  IconMessageCircle,
  IconReceipt,
  IconSearch,
  IconSettings,
  IconTruck,
  IconUsers,
} from "@tabler/icons-react"
import { usePathname } from "next/navigation"

import { NavMain } from "@/components/nav-main"
import { NavSecondary } from "@/components/nav-secondary"
import { NavFiles } from "@/components/nav-files"
import { NavProjects } from "@/components/nav-projects"
import { NavUser } from "@/components/nav-user"
import { useCommandMenu } from "@/components/command-menu-provider"
import { useSettings } from "@/components/settings-provider"
import { useAgentOptional } from "@/components/agent/agent-provider"
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
      title: "Compass",
      url: "/dashboard",
      icon: IconDashboard,
    },
    {
      title: "Projects",
      url: "/dashboard/projects",
      icon: IconFolder,
    },
    {
      title: "People",
      url: "/dashboard/people",
      icon: IconUsers,
    },
    {
      title: "Schedule",
      url: "/dashboard/projects/demo-project-1/schedule",
      icon: IconCalendarStats,
    },
    {
      title: "Files",
      url: "/dashboard/files",
      icon: IconFiles,
    },
    {
      title: "Customers",
      url: "/dashboard/customers",
      icon: IconAddressBook,
    },
    {
      title: "Vendors",
      url: "/dashboard/vendors",
      icon: IconTruck,
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
      url: "#",
      icon: IconSettings,
    },
    {
      title: "Get Help",
      url: "#",
      icon: IconHelp,
    },
  ],
}

function SidebarNav({
  projects,
}: {
  projects: { id: string; name: string }[]
}) {
  const pathname = usePathname()
  const { state, setOpen } = useSidebar()
  const { open: openSearch } = useCommandMenu()
  const { open: openSettings } = useSettings()
  const agent = useAgentOptional()
  const isExpanded = state === "expanded"
  const isFilesMode = pathname?.startsWith("/dashboard/files")
  const isProjectMode = /^\/dashboard\/projects\/[^/]+/.test(
    pathname ?? ""
  )

  // Allow manual collapse/expand in all modes
  // React.useEffect(() => {
  //   if ((isFilesMode || isProjectMode) && !isExpanded) {
  //     setOpen(true)
  //   }
  // }, [isFilesMode, isProjectMode, isExpanded, setOpen])

  const showContext = isExpanded && (isFilesMode || isProjectMode)

  const mode = showContext && isFilesMode
    ? "files"
    : showContext && isProjectMode
      ? "projects"
      : "main"

  const secondaryItems = [
    ...data.navSecondary.map((item) =>
      item.title === "Settings"
        ? { ...item, onClick: openSettings }
        : item
    ),
    ...(agent ? [{ title: "Assistant", icon: IconMessageCircle, onClick: agent.open }] : []),
    { title: "Search", icon: IconSearch, onClick: openSearch },
  ]

  return (
    <div key={mode} className="animate-in fade-in slide-in-from-left-1 flex flex-1 flex-col duration-150">
      {mode === "files" && (
        <React.Suspense>
          <NavFiles />
        </React.Suspense>
      )}
      {mode === "projects" && <NavProjects projects={projects} />}
      {mode === "main" && (
        <>
          <NavMain items={data.navMain} />
          <NavSecondary items={secondaryItems} className="mt-auto" />
        </>
      )}
    </div>
  )
}

export function AppSidebar({
  projects = [],
  user,
  ...props
}: React.ComponentProps<typeof Sidebar> & {
  readonly projects?: ReadonlyArray<{ readonly id: string; readonly name: string }>
  readonly user: SidebarUser | null
}) {
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
      </SidebarHeader>
      <SidebarContent>
        <SidebarNav projects={projects as { id: string; name: string }[]} />
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={user} />
      </SidebarFooter>
    </Sidebar>
  )
}
