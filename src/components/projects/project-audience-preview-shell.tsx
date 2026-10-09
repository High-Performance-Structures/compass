import type * as React from "react"
import { CompassMark } from "@/components/compass-mark"
import { ReleaseStageLabel } from "@/components/release-stage-label"
import Link from "next/link"
import {
  IconPalette,
  IconCalendar,
  IconClipboardCheck,
  IconEye,
  IconFileDollar,
  IconFileInvoice,
  IconFiles,
  IconHome,
  IconMessageCircle,
  IconPhoto,
  IconQuestionMark,
  IconShoppingCartQuestion,
  IconUsers,
  IconShieldCheck,
} from "@tabler/icons-react"

import type { AudienceProjectOption } from "@/app/actions/project-audience-preview"
import type { ProjectAudience } from "@/lib/project-audience-access"
import {
  projectAudiencePreviewHref,
  projectAudienceSectionHref,
  type ProjectAudienceWorkspaceSection,
} from "@/lib/project-audience-preview-routes"
import { Button } from "@/components/ui/button"
import { ProjectAudienceSwitcher } from "@/components/projects/project-audience-switcher"
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
    label: "Dashboard",
    section: "overview",
    icon: <IconHome className="size-4" />,
  },
  {
    label: "Selections & Decisions",
    section: "selections",
    icon: <IconPalette className="size-4" />,
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
    label: "Plans & Documents",
    section: "documents",
    icon: <IconFiles className="size-4" />,
  },
  {
    label: "Project Team",
    section: "team",
    icon: <IconUsers className="size-4" />,
  },
]

const SUB_VENDOR_NAVIGATION: readonly PreviewNavigationItem[] = [
  {
    label: "Dashboard",
    section: "overview",
    icon: <IconHome className="size-4" />,
  },
  {
    label: "Approved Selections",
    section: "selections",
    icon: <IconPalette className="size-4" />,
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
    label: "RFQs",
    section: "rfqs",
    icon: <IconShoppingCartQuestion className="size-4" />,
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
    label: "Plans & Documents",
    section: "documents",
    icon: <IconFiles className="size-4" />,
  },
  {
    label: "Project Team",
    section: "team",
    icon: <IconUsers className="size-4" />,
  },
]

const OWNER_WARRANTY_NAVIGATION: PreviewNavigationItem = {
  label: "Warranty",
  section: "warranty",
  icon: <IconShieldCheck className="size-4" />,
}

function audienceRoute(audience: ProjectAudience): "owner" | "sub-vendor" {
  return audience === "owner" ? "owner" : "sub-vendor"
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
  warrantyEnabled = false,
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
  readonly warrantyEnabled?: boolean
  readonly children: React.ReactNode
}): React.ReactElement {
  const routeAudience = audienceRoute(audience)
  const homeHref = projectAudiencePreviewHref(projectId, routeAudience)
  const navigation =
    audience === "owner"
      ? warrantyEnabled
        ? [...OWNER_NAVIGATION, OWNER_WARRANTY_NAVIGATION]
        : OWNER_NAVIGATION
      : warrantyEnabled
        ? [...SUB_VENDOR_NAVIGATION, OWNER_WARRANTY_NAVIGATION]
        : SUB_VENDOR_NAVIGATION

  return (
    <div
      className={cn(
        "bg-muted/20 text-foreground md:grid md:grid-cols-[21.5rem_minmax(0,1fr)]",
        contentMode === "viewport"
          ? "h-dvh min-h-0 overflow-hidden"
          : "min-h-screen"
      )}
    >
      <aside className="sticky top-0 hidden h-dvh min-h-0 flex-col border-r bg-sidebar text-sidebar-foreground md:flex">
        {/* Same brand placement as the office sidebar: Compass names the
            product at the top, the company signs the bottom. */}
        <div className="border-b border-sidebar-border p-4">
          <div className="flex items-center gap-3">
            <Link
              href={homeHref}
              aria-label="Compass home"
              className="shrink-0 text-sidebar-foreground transition-transform hover:scale-[1.03]"
            >
              <CompassMark className="size-8" />
            </Link>
            <div className="flex min-w-0 flex-col gap-0.5">
              <Link
                href={homeHref}
                className="text-base font-semibold uppercase tracking-[0.32em] text-sidebar-foreground"
              >
                Compass
              </Link>
              <span className="truncate font-mono text-xs tracking-[0.16em] text-sidebar-foreground/60">
                HIGH PERFORMANCE STRUCTURES
              </span>
            </div>
          </div>
        </div>

        <div className="border-b border-sidebar-border p-3">
          {projectOptions.length > 1 ? (
            <div className="grid gap-1">
              <p className="px-2 text-xs text-sidebar-foreground/60">
                {audience === "owner" ? "Owner workspace" : "Partner workspace"} · Current project
              </p>
              <ProjectAudienceSwitcher
                projects={projectOptions}
                currentProjectId={projectId}
                audience={routeAudience}
                section={activeSection}
                className="h-9 border-sidebar-border bg-sidebar text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              />
            </div>
          ) : (
            <div className="px-2 py-2">
              <p className="text-xs text-sidebar-foreground/60">
                {audience === "owner" ? "Owner workspace" : "Partner workspace"} · Current project
              </p>
              <p className="mt-1 truncate text-sm font-medium">
                {projectNumber ?? projectName}
              </p>
            </div>
          )}
        </div>

        <nav
          className="compass-sidebar-scroll min-h-0 flex-1 space-y-1 overflow-y-auto p-3"
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
        <div className="border-t border-sidebar-border pt-2">
          <ReleaseStageLabel />
        </div>
      </aside>

      <div
        className={cn(
          "min-w-0",
          contentMode === "viewport" &&
            "flex h-dvh min-h-0 flex-col overflow-hidden"
        )}
      >
        <header className="sticky top-0 z-40 hidden h-12 items-center justify-between gap-4 border-b border-border/40 bg-background/80 px-4 backdrop-blur-sm md:flex">
          <Link
            href={homeHref}
            className="min-w-0 truncate text-xs text-muted-foreground hover:text-foreground"
          >
            {projectNumber ? `${projectNumber} · ` : ""}
            {projectName}
          </Link>
          <ProjectAudienceHeaderControls
            viewer={viewer}
            messageShortcut={messageShortcut}
            projectId={projectId}
            audience={audience}
          />
        </header>

        {viewerIsInternal && (
          <div className="border-b bg-warning/10 px-4 py-2 text-warning">
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
                <ProjectAudiencePreviewWindowControls
                  fallbackHref={`/dashboard/projects/${encodeURIComponent(projectId)}`}
                />
              </div>
            </div>
          </div>
        )}

        <header className="sticky top-0 z-40 border-b bg-background/95 px-3 py-2 backdrop-blur md:hidden">
          <div className="flex items-center justify-between gap-3">
            <Link href={homeHref} className="flex min-w-0 items-center gap-2.5">
              <CompassMark className="size-7 shrink-0" />
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold">
                  {projectNumber ?? projectName}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {audience === "owner" ? "Owner Compass" : "Partner Compass"}
                </span>
              </span>
            </Link>
            <ProjectAudienceHeaderControls
              viewer={viewer}
              messageShortcut={messageShortcut}
              projectId={projectId}
              audience={audience}
            />
          </div>
          {projectOptions.length > 1 && (
            <div className="mt-2">
              <p className="sr-only">Current project</p>
              <ProjectAudienceSwitcher
                projects={projectOptions}
                currentProjectId={projectId}
                audience={routeAudience}
                section={activeSection}
                className="h-9 bg-background"
              />
            </div>
          )}
          <nav
            aria-label="Project workspace"
            className="mt-2 flex gap-1 overflow-x-auto border-t pt-2"
          >
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
