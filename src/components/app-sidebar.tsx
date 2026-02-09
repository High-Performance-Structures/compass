"use client"

import * as React from "react"
import {
  IconAddressBook,
  IconCalendarStats,
  IconDashboard,
  IconFiles,
  IconFolder,
  IconMessageCircle,
  IconReceipt,
  IconSearch,
  IconSettings,
  IconTruck,
  IconUsers,
} from "@tabler/icons-react"
import { usePathname } from "next/navigation"

import { NavMain } from "@/components/nav-main"
import { NavDashboards } from "@/components/nav-dashboards"
import { NavSecondary } from "@/components/nav-secondary"
import { NavFiles } from "@/components/nav-files"
import { NavProjects } from "@/components/nav-projects"
import { useCommandMenu } from "@/components/command-menu-provider"
import { useSettings } from "@/components/settings-provider"
import { useFeedback } from "@/components/feedback-widget"
import type { SidebarUser } from "@/lib/auth"
import {
  Sidebar,
  SidebarContent,
  useSidebar,
} from "@/components/ui/sidebar"

const data = {
  navMain: [
    {
      title: "Compass Dashboard",
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
  const { state } = useSidebar()
  const { open: openSearch } = useCommandMenu()
  const { open: openSettings } = useSettings()
  const { open: openFeedback } = useFeedback()
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
    { title: "Feedback", icon: IconMessageCircle, onClick: openFeedback },
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
  ...props
}: React.ComponentProps<typeof Sidebar> & {
  readonly projects?: ReadonlyArray<{ readonly id: string; readonly name: string }>
  readonly dashboards?: ReadonlyArray<{ readonly id: string; readonly name: string }>
  readonly user: SidebarUser | null
}) {
  return (
    <Sidebar collapsible="icon" {...props}>

      <SidebarContent className="py-6">
        <SidebarNav
          projects={projects as { id: string; name: string }[]}
          dashboards={dashboards}
        />
      </SidebarContent>
    </Sidebar>
  )
}
