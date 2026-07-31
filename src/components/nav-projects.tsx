"use client"

import type { Icon } from "@tabler/icons-react"
import {
  IconAddressBook,
  IconArrowLeft,
  IconCalendarStats,
  IconClipboardCheck,
  IconClipboardText,
  IconEye,
  IconFileDollar,
  IconFileInvoice,
  IconFolder,
  IconHome2,
  IconMailForward,
  IconMessageCircleQuestion,
  IconMessages,
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
import { ProjectQuickSwitcher } from "@/components/projects/project-quick-switcher"
import { cn } from "@/lib/utils"
import type { ProjectListItem } from "@/app/actions/projects"
import { projectAudiencePreviewHref } from "@/lib/project-audience-preview-routes"

type ProjectSectionKey =
  | "overview"
  | "schedule"
  | "todos"
  | "conversations"
  | "owner-updates"
  | "daily-logs"
  | "photos"
  | "selections"
  | "rfis"
  | "rfqs"
  | "purchase-orders"
  | "change-orders"
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
    title: "To-Dos",
    hrefSuffix: "todos",
    icon: IconClipboardCheck,
    section: "todos",
  },
  {
    title: "Conversations",
    hrefSuffix: "conversations",
    icon: IconMessages,
    section: "conversations",
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
    title: "Change Orders",
    hrefSuffix: "change-orders",
    icon: IconFileInvoice,
    section: "change-orders",
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

function projectSectionHref(projectId: string, suffix: string): string {
  if (suffix === "preview/owner") {
    return projectAudiencePreviewHref(projectId, "owner")
  }
  if (suffix === "preview/sub-vendor") {
    return projectAudiencePreviewHref(projectId, "sub-vendor")
  }

  const baseHref = `/dashboard/projects/${projectId}`
  return suffix ? `${baseHref}/${suffix}` : baseHref
}

function isPreviewSection(section: ProjectSectionKey): boolean {
  return section === "preview-owner" || section === "preview-sub-vendor"
}

function projectTargetSection(
  section: ProjectSectionKey
): string | undefined {
  const matchingItem = PROJECT_SECTION_ITEMS.find(
    (item) => item.section === section
  )
  return matchingItem?.hrefSuffix || undefined
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
    case "todos":
    case "conversations":
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
  const activeTargetSection = projectTargetSection(activeSection)

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
        <div className="mx-2 mb-2">
          <ProjectQuickSwitcher
            projects={projects}
            currentProjectId={activeProject.id}
            targetSection={activeTargetSection}
            placeholder="Switch project..."
            className="h-10 w-full border-sidebar-border/70 bg-sidebar-accent/35 px-2 text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          />
          {activeProject.projectNumber && (
            <p className="mt-1 truncate px-2 text-xs text-sidebar-foreground/60">
              {activeProject.name}
            </p>
          )}
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
                    <Link
                      href={projectSectionHref(activeId, item.hrefSuffix)}
                      target={isPreviewSection(item.section) ? "_blank" : undefined}
                      rel={
                        isPreviewSection(item.section)
                          ? "noopener noreferrer"
                          : undefined
                      }
                    >
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
