import type * as React from "react"
import Link from "next/link"
import {
  IconBuilding,
  IconCalendar,
  IconChevronDown,
  IconClipboardCheck,
  IconEye,
  IconHome,
  IconMessageCircle,
  IconPhoto,
  IconQuestionMark,
  IconUsers,
} from "@tabler/icons-react"

import type { AudienceProjectOption } from "@/app/actions/project-audience-preview"
import type { ProjectAudience } from "@/lib/project-audience-access"
import { projectAudiencePreviewHref } from "@/lib/project-audience-preview-routes"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ProjectAudiencePreviewWindowControls } from "@/components/projects/project-audience-preview-window-controls"
import { ProjectAudienceSidebarProfile } from "@/components/projects/project-audience-sidebar-profile"
import { cn } from "@/lib/utils"

type PreviewNavigationItem = {
  readonly label: string
  readonly anchor: string
  readonly icon: React.ReactElement
}

const OWNER_NAVIGATION: readonly PreviewNavigationItem[] = [
  {
    label: "Overview",
    anchor: "overview",
    icon: <IconHome className="size-4" />,
  },
  {
    label: "Owner Updates",
    anchor: "updates",
    icon: <IconClipboardCheck className="size-4" />,
  },
  {
    label: "Schedule",
    anchor: "schedule",
    icon: <IconCalendar className="size-4" />,
  },
  {
    label: "Conversations",
    anchor: "messages",
    icon: <IconMessageCircle className="size-4" />,
  },
  { label: "Photos", anchor: "photos", icon: <IconPhoto className="size-4" /> },
  {
    label: "Project Team",
    anchor: "team",
    icon: <IconUsers className="size-4" />,
  },
]

const SUB_VENDOR_NAVIGATION: readonly PreviewNavigationItem[] = [
  {
    label: "Overview",
    anchor: "overview",
    icon: <IconHome className="size-4" />,
  },
  {
    label: "Schedule",
    anchor: "schedule",
    icon: <IconCalendar className="size-4" />,
  },
  {
    label: "Commitments",
    anchor: "commitments",
    icon: <IconClipboardCheck className="size-4" />,
  },
  {
    label: "RFIs",
    anchor: "rfis",
    icon: <IconQuestionMark className="size-4" />,
  },
  {
    label: "Conversations",
    anchor: "messages",
    icon: <IconMessageCircle className="size-4" />,
  },
  { label: "Photos", anchor: "photos", icon: <IconPhoto className="size-4" /> },
  {
    label: "Project Team",
    anchor: "team",
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
  }
  readonly viewerIsInternal: boolean
  readonly children: React.ReactNode
}): React.ReactElement {
  const routeAudience = audienceRoute(audience)
  const homeHref = projectAudiencePreviewHref(projectId, routeAudience)
  const navigation =
    audience === "owner" ? OWNER_NAVIGATION : SUB_VENDOR_NAVIGATION

  return (
    <div className="min-h-screen bg-muted/20 text-foreground md:grid md:grid-cols-[16rem_minmax(0,1fr)]">
      <aside className="sticky top-0 hidden h-screen flex-col border-r bg-sidebar text-sidebar-foreground md:flex">
        <div className="border-b border-sidebar-border p-4">
          <Link href={homeHref} className="flex items-center gap-3">
            <span className="grid size-9 shrink-0 place-items-center bg-primary text-primary-foreground">
              <IconBuilding className="size-5" />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold">
                Compass
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
                      href={projectAudiencePreviewHref(
                        project.id,
                        routeAudience
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
              key={item.anchor}
              href={`${homeHref}#${item.anchor}`}
              className="flex items-center gap-3 px-3 py-2 text-sm text-sidebar-foreground/75 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            >
              {item.icon}
              {item.label}
            </Link>
          ))}
        </nav>

        <ProjectAudienceSidebarProfile viewer={viewer} />
      </aside>

      <div className="min-w-0">
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

        <header className="sticky top-0 z-30 border-b bg-background/95 px-4 py-3 backdrop-blur md:hidden">
          <div className="flex items-center justify-between gap-3">
            <Link href={homeHref} className="min-w-0">
              <p className="truncate text-sm font-semibold">
                {projectNumber ?? projectName}
              </p>
              <p className="text-xs text-muted-foreground">
                {audience === "owner" ? "Owner Compass" : "Partner Compass"}
              </p>
            </Link>
            <Badge variant="outline">Compass</Badge>
          </div>
          <nav className="mt-3 flex gap-1 overflow-x-auto border-t pt-2">
            {navigation.map((item) => (
              <Link
                key={item.anchor}
                href={`${homeHref}#${item.anchor}`}
                className={cn(
                  "flex shrink-0 items-center gap-1.5 px-2 py-1.5 text-xs",
                  "text-muted-foreground hover:bg-accent hover:text-foreground"
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
