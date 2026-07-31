import type * as React from "react"
import Image from "next/image"
import Link from "next/link"
import {
  IconCalendar,
  IconChevronDown,
  IconClipboardCheck,
  IconEye,
  IconFileDollar,
  IconFileInvoice,
  IconHome,
  IconMessageCircle,
  IconPhoto,
  IconQuestionMark,
  IconUsers,
} from "@tabler/icons-react"

import type { AudienceProjectOption } from "@/app/actions/project-audience-preview"
import type { ProjectAudience } from "@/lib/project-audience-access"
import {
  projectAudiencePreviewHref,
  projectAudienceSectionHref,
  type ProjectAudienceWorkspaceSection,
} from "@/lib/project-audience-preview-routes"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ProjectAudiencePreviewWindowControls } from "@/components/projects/project-audience-preview-window-controls"
import { ProjectAudienceHeaderControls } from "@/components/projects/project-audience-header-controls"
import { ProjectAudienceSidebarProfile } from "@/components/projects/project-audience-sidebar-profile"
import { cn } from "@/lib/utils"
import type { ProjectAudienceMessageShortcut } from "@/lib/project-audience-direct-message"

type PreviewNavigationItem = {
  readonly label: string
  readonly section: ProjectAudienceWorkspaceSection
  readonly icon: React.ReactElement
}

const OWNER_NAVIGATION: readonly PreviewNavigationItem[] = [
  {
    label: "Overview",
    section: "overview",
    icon: <IconHome className="size-4" />,
  },
  {
    label: "Owner Updates",
    section: "updates",
    icon: <IconClipboardCheck className="size-4" />,
  },
  {
    label: "Schedule",
    section: "schedule",
    icon: <IconCalendar className="size-4" />,
  },
  {
    label: "Budget / G703",
    section: "budget",
    icon: <IconFileDollar className="size-4" />,
  },
  {
    label: "Change Orders",
    section: "change-orders",
    icon: <IconFileInvoice className="size-4" />,
  },
  {
    label: "Conversations",
    section: "conversations",
    icon: <IconMessageCircle className="size-4" />,
  },
  {
    label: "Photos",
    section: "photos",
    icon: <IconPhoto className="size-4" />,
  },
  {
    label: "Project Team",
    section: "team",
    icon: <IconUsers className="size-4" />,
  },
]

const SUB_VENDOR_NAVIGATION: readonly PreviewNavigationItem[] = [
  {
    label: "Overview",
    section: "overview",
    icon: <IconHome className="size-4" />,
  },
  {
    label: "Schedule",
    section: "schedule",
    icon: <IconCalendar className="size-4" />,
  },
  {
    label: "Commitments",
    section: "commitments",
    icon: <IconClipboardCheck className="size-4" />,
  },
  {
    label: "RFIs",
    section: "rfis",
    icon: <IconQuestionMark className="size-4" />,
  },
  {
    label: "Change Orders",
    section: "change-orders",
    icon: <IconFileInvoice className="size-4" />,
  },
  {
    label: "Conversations",
    section: "conversations",
    icon: <IconMessageCircle className="size-4" />,
  },
  {
    label: "Photos",
    section: "photos",
    icon: <IconPhoto className="size-4" />,
  },
  {
    label: "Project Team",
    section: "team",
    icon: <IconUsers className="size-4" />,
  },
]

function audienceRoute(audience: ProjectAudience): "owner" | "sub-vendor" {
  return audience === "owner" ? "owner" : "sub-vendor"
}

function projectOptionLabel(project: AudienceProjectOption): string {
  return project.projectNumber
    ? `${project.projectNumber} · ${project.name}`
    : project.name
}

export function ProjectAudiencePreviewShell({
  audience,
  projectId,
  projectName,
  projectNumber,
  projectOptions,
  viewer,
  viewerIsInternal,
  messageShortcut,
  contentMode = "document",
  activeSection = "overview",
  children,
}: {
  readonly audience: ProjectAudience
  readonly projectId: string
  readonly projectName: string
  readonly projectNumber: string | null
  readonly projectOptions: readonly AudienceProjectOption[]
  readonly viewer: {
    readonly name: string
    readonly email: string
    readonly avatarUrl: string | null
    readonly sidebarPhotoUrl: string | null
  }
  readonly viewerIsInternal: boolean
  readonly messageShortcut: ProjectAudienceMessageShortcut | null
  readonly contentMode?: "document" | "viewport"
  readonly activeSection?: ProjectAudienceWorkspaceSection
  readonly children: React.ReactNode
}): React.ReactElement {
  const routeAudience = audienceRoute(audience)
  const homeHref = projectAudiencePreviewHref(projectId, routeAudience)
  const navigation =
    audience === "owner" ? OWNER_NAVIGATION : SUB_VENDOR_NAVIGATION

  return (
    <div
      className={cn(
        "bg-muted/20 text-foreground md:grid md:grid-cols-[16rem_minmax(0,1fr)]",
        contentMode === "viewport"
          ? "h-dvh min-h-0 overflow-hidden"
          : "min-h-screen"
      )}
    >
      <aside className="sticky top-0 hidden h-dvh flex-col border-r bg-sidebar text-sidebar-foreground md:flex">
        <div className="border-b border-sidebar-border p-4">
          <Link href={homeHref} className="flex items-center gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center">
              <Image
                src="/department-logos/hps-h-green.svg"
                alt="High Performance Structures Inc."
                width={36}
                height={36}
                className="size-9 rounded-[5px] object-contain"
                priority
                unoptimized
              />
            </span>
            <span className="min-w-0">
              <span className="block text-xs font-semibold leading-tight">
                High Performance Structures Inc.
              </span>
              <span className="block truncate text-xs text-sidebar-foreground/65">
                {audience === "owner" ? "Owner workspace" : "Partner workspace"}
              </span>
            </span>
          </Link>
        </div>

        <div className="border-b border-sidebar-border p-3">
          {projectOptions.length > 1 ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  className="h-auto w-full justify-between px-2 py-2 text-left"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-xs text-sidebar-foreground/60">
                      Current project
                    </span>
                    <span className="mt-1 block truncate text-sm font-medium">
                      {projectNumber ?? projectName}
                    </span>
                  </span>
                  <IconChevronDown className="size-4 shrink-0" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="right" align="start" className="w-80">
                {projectOptions.map((project) => (
                  <DropdownMenuItem key={project.id} asChild>
                    <Link
                      href={projectAudienceSectionHref(
                        project.id,
                        routeAudience,
                        activeSection
                      )}
                    >
                      {projectOptionLabel(project)}
                    </Link>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <div className="px-2 py-2">
              <p className="text-xs text-sidebar-foreground/60">
                Current project
              </p>
              <p className="mt-1 truncate text-sm font-medium">
                {projectNumber ?? projectName}
              </p>
            </div>
          )}
        </div>

        <nav
          className="flex-1 space-y-1 overflow-y-auto p-3"
          aria-label="Project workspace"
        >
          {navigation.map((item) => (
            <Link
              key={item.section}
              href={projectAudienceSectionHref(
                projectId,
                routeAudience,
                item.section
              )}
              aria-current={activeSection === item.section ? "page" : undefined}
              className={cn(
                "flex items-center gap-3 px-3 py-2 text-sm transition-colors",
                activeSection === item.section
                  ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/75 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              )}
            >
              {item.icon}
              {item.label}
            </Link>
          ))}
        </nav>

        <ProjectAudienceSidebarProfile viewer={viewer} />
      </aside>

      <div
        className={cn(
          "min-w-0",
          contentMode === "viewport" &&
            "flex h-dvh min-h-0 flex-col overflow-hidden"
        )}
      >
        <header className="sticky top-0 z-40 hidden h-12 items-center justify-end border-b border-border/40 bg-background/80 px-4 backdrop-blur-sm md:flex">
          <ProjectAudienceHeaderControls
            viewer={viewer}
            messageShortcut={messageShortcut}
          />
        </header>

        {viewerIsInternal && (
          <div className="border-b bg-amber-50 px-4 py-2 text-amber-950 dark:bg-amber-950 dark:text-amber-50">
            <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2">
              <p className="flex items-center gap-2 text-xs font-medium">
                <IconEye className="size-4" />
                Preview mode — external users see this same guarded workspace.
              </p>
              <div className="flex items-center gap-2">
                <Button
                  asChild
                  size="sm"
                  variant={audience === "owner" ? "default" : "outline"}
                >
                  <Link href={projectAudiencePreviewHref(projectId, "owner")}>
                    Owner
                  </Link>
                </Button>
                <Button
                  asChild
                  size="sm"
                  variant={audience === "sub_vendor" ? "default" : "outline"}
                >
                  <Link
                    href={projectAudiencePreviewHref(projectId, "sub-vendor")}
                  >
                    Sub/vendor
                  </Link>
                </Button>
                <ProjectAudiencePreviewWindowControls />
              </div>
            </div>
          </div>
        )}

        <header className="sticky top-0 z-40 border-b bg-background/95 px-3 py-2 backdrop-blur md:hidden">
          <div className="flex items-center justify-between gap-3">
            <Link href={homeHref} className="min-w-0">
              <p className="truncate text-sm font-semibold">
                {projectNumber ?? projectName}
              </p>
              <p className="text-xs text-muted-foreground">
                {audience === "owner" ? "Owner Compass" : "Partner Compass"}
              </p>
            </Link>
            <ProjectAudienceHeaderControls
              viewer={viewer}
              messageShortcut={messageShortcut}
            />
          </div>
          <nav className="mt-3 flex gap-1 overflow-x-auto border-t pt-2">
            {navigation.map((item) => (
              <Link
                key={item.section}
                href={projectAudienceSectionHref(
                  projectId,
                  routeAudience,
                  item.section
                )}
                aria-current={
                  activeSection === item.section ? "page" : undefined
                }
                className={cn(
                  "flex shrink-0 items-center gap-1.5 px-2 py-1.5 text-xs",
                  activeSection === item.section
                    ? "bg-accent font-medium text-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground"
                )}
              >
                {item.icon}
                {item.label}
              </Link>
            ))}
          </nav>
        </header>

        {children}
      </div>
    </div>
  )
}
