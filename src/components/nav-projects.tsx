"use client"

import type { Icon } from "@tabler/icons-react"
import {
  IconAddressBook,
  IconArrowLeft,
  IconCalendarStats,
  IconClipboardText,
  IconEye,
  IconFileDollar,
  IconFolder,
  IconHome2,
  IconMailForward,
  IconMessageCircleQuestion,
  IconPalette,
  IconPhoto,
  IconShoppingCart,
  IconShoppingCartQuestion,
  IconUsers,
} from "@tabler/icons-react"
import Link from "next/link"
import { usePathname } from "next/navigation"

import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import { cn } from "@/lib/utils"
import type { ProjectListItem } from "@/app/actions/projects"

type ProjectSectionKey =
  | "overview"
  | "schedule"
  | "owner-updates"
  | "daily-logs"
  | "photos"
  | "selections"
  | "rfis"
  | "rfqs"
  | "purchase-orders"
  | "budget"
  | "financials"
  | "contacts"
  | "preview-owner"
  | "preview-sub-vendor"

type ProjectSectionItem = {
  readonly title: string
  readonly hrefSuffix: string
  readonly icon: Icon
  readonly section: ProjectSectionKey
}

const PROJECT_SECTION_ITEMS: readonly ProjectSectionItem[] = [
  {
    title: "Overview",
    hrefSuffix: "",
    icon: IconHome2,
    section: "overview",
  },
  {
    title: "Schedule",
    hrefSuffix: "schedule",
    icon: IconCalendarStats,
    section: "schedule",
  },
  {
    title: "Owner Updates",
    hrefSuffix: "owner-updates",
    icon: IconMailForward,
    section: "owner-updates",
  },
  {
    title: "Daily Logs",
    hrefSuffix: "daily-logs",
    icon: IconClipboardText,
    section: "daily-logs",
  },
  {
    title: "Photos",
    hrefSuffix: "photos",
    icon: IconPhoto,
    section: "photos",
  },
  {
    title: "Selections",
    hrefSuffix: "selections",
    icon: IconPalette,
    section: "selections",
  },
  {
    title: "RFIs",
    hrefSuffix: "rfis",
    icon: IconMessageCircleQuestion,
    section: "rfis",
  },
  {
    title: "RFQs",
    hrefSuffix: "rfqs",
    icon: IconShoppingCartQuestion,
    section: "rfqs",
  },
  {
    title: "Purchase Orders",
    hrefSuffix: "purchase-orders",
    icon: IconShoppingCart,
    section: "purchase-orders",
  },
  {
    title: "Budget / G703",
    hrefSuffix: "budget",
    icon: IconFileDollar,
    section: "budget",
  },
  {
    title: "Financials",
    hrefSuffix: "financials",
    icon: IconFileDollar,
    section: "financials",
  },
  {
    title: "Contacts",
    hrefSuffix: "contacts",
    icon: IconAddressBook,
    section: "contacts",
  },
  {
    title: "Owner Preview",
    hrefSuffix: "preview/owner",
    icon: IconEye,
    section: "preview-owner",
  },
  {
    title: "Sub/Vendor Preview",
    hrefSuffix: "preview/sub-vendor",
    icon: IconUsers,
    section: "preview-sub-vendor",
  },
]

function projectDisplay(project: ProjectListItem): string {
  return project.projectNumber ?? project.name
}

function projectSectionHref(projectId: string, suffix: string): string {
  const baseHref = `/dashboard/projects/${projectId}`
  return suffix ? `${baseHref}/${suffix}` : baseHref
}

function activeProjectSection(pathname: string | null): ProjectSectionKey {
  const suffix = pathname?.replace(/^\/dashboard\/projects\/[^/]+/, "") ?? ""
  const parts = suffix.split("/").filter(Boolean)
  const section = parts[0] ?? "overview"

  if (section === "preview" && parts[1] === "owner") return "preview-owner"
  if (section === "preview" && parts[1] === "sub-vendor") {
    return "preview-sub-vendor"
  }

  switch (section) {
    case "budget":
    case "contacts":
    case "daily-logs":
    case "financials":
    case "owner-updates":
    case "photos":
    case "selections":
    case "purchase-orders":
    case "rfqs":
    case "rfis":
    case "schedule":
      return section
    default:
      return "overview"
  }
}

export function NavProjects({
  projects,
}: {
  projects: ReadonlyArray<ProjectListItem>
}) {
  const pathname = usePathname()
  const activeId = pathname?.match(
    /^\/dashboard\/projects\/([^/]+)/
  )?.[1]
  const activeProject = projects.find((project) => project.id === activeId)
  const activeSection = activeProjectSection(pathname)

  return (
    <>
      <SidebarGroup>
        <SidebarGroupContent>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton asChild tooltip="All projects">
                <Link href="/dashboard/projects">
                  <IconArrowLeft />
                  <span>All projects</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>

      {activeProject && (
        <div className="mx-2 mb-2 rounded-lg border border-sidebar-border/70 bg-sidebar-accent/35 px-3 py-2">
          <div className="flex min-w-0 items-start gap-2">
            <IconFolder className="mt-0.5 size-4 shrink-0 text-sidebar-foreground/70" />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">
                {projectDisplay(activeProject)}
              </p>
              {activeProject.projectNumber && (
                <p className="truncate text-xs text-sidebar-foreground/60">
                  {activeProject.name}
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      <SidebarGroup>
        <SidebarGroupContent>
          <SidebarMenu>
            {!activeId ? (
              <SidebarMenuItem>
                <SidebarMenuButton disabled>
                  <IconFolder />
                  <span className="text-muted-foreground">No project selected</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ) : (
              PROJECT_SECTION_ITEMS.map((item) => (
                <SidebarMenuItem key={`${activeId}-${item.section}`}>
                  <SidebarMenuButton
                    asChild
                    tooltip={item.title}
                    className={cn(
                      activeSection === item.section &&
                        "bg-sidebar-foreground/10 font-medium"
                    )}
                  >
                    <Link href={projectSectionHref(activeId, item.hrefSuffix)}>
                      <item.icon />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))
            )}
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
    </>
  )
}
