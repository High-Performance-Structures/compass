import type * as React from "react"
import Link from "next/link"
import { IconBuilding, IconEye } from "@tabler/icons-react"

import type { ProjectAudience } from "@/lib/project-audience-access"
import { projectAudiencePreviewHref } from "@/lib/project-audience-preview-routes"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ProjectAudiencePreviewWindowControls } from "@/components/projects/project-audience-preview-window-controls"
import { cn } from "@/lib/utils"

type PreviewNavigationItem = {
  readonly label: string
  readonly anchor: string
}

const OWNER_NAVIGATION: readonly PreviewNavigationItem[] = [
  { label: "Home", anchor: "overview" },
  { label: "Updates", anchor: "updates" },
  { label: "Schedule", anchor: "schedule" },
  { label: "Photos", anchor: "photos" },
  { label: "Team", anchor: "team" },
]

const SUB_VENDOR_NAVIGATION: readonly PreviewNavigationItem[] = [
  { label: "Home", anchor: "overview" },
  { label: "Schedule", anchor: "schedule" },
  { label: "Commitments", anchor: "commitments" },
  { label: "RFIs", anchor: "rfis" },
  { label: "Messages", anchor: "messages" },
  { label: "Photos", anchor: "photos" },
  { label: "Team", anchor: "team" },
]

function audienceRoute(audience: ProjectAudience): "owner" | "sub-vendor" {
  return audience === "owner" ? "owner" : "sub-vendor"
}

export function ProjectAudiencePreviewShell({
  audience,
  projectId,
  projectName,
  projectNumber,
  viewerIsInternal,
  children,
}: {
  readonly audience: ProjectAudience
  readonly projectId: string
  readonly projectName: string
  readonly projectNumber: string | null
  readonly viewerIsInternal: boolean
  readonly children: React.ReactNode
}): React.ReactElement {
  const routeAudience = audienceRoute(audience)
  const homeHref = projectAudiencePreviewHref(projectId, routeAudience)
  const navigation =
    audience === "owner" ? OWNER_NAVIGATION : SUB_VENDOR_NAVIGATION

  return (
    <div className="min-h-screen bg-muted/20 text-foreground">
      <header className="sticky top-0 z-40 border-b bg-background/95 shadow-sm backdrop-blur">
        {viewerIsInternal && (
          <div className="border-b bg-amber-50 px-4 py-2 text-amber-950 dark:bg-amber-950 dark:text-amber-50">
            <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2">
              <p className="flex items-center gap-2 text-xs font-medium">
                <IconEye className="size-4" />
                Preview mode — this is the Compass experience visible to{" "}
                {audience === "owner" ? "owners" : "subcontractors and vendors"}.
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

        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3 sm:px-6">
          <Link href={homeHref} className="flex min-w-0 items-center gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-md bg-primary text-primary-foreground">
              <IconBuilding className="size-5" />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold">
                Compass
              </span>
              <span className="block truncate text-xs text-muted-foreground">
                {projectNumber ? `${projectNumber} · ` : ""}
                {projectName}
              </span>
            </span>
          </Link>

          <nav
            aria-label={`${audience === "owner" ? "Owner" : "Subcontractor and vendor"} preview`}
            className="order-3 flex w-full gap-1 overflow-x-auto border-t pt-3 sm:order-none sm:w-auto sm:flex-1 sm:border-0 sm:pt-0"
          >
            {navigation.map((item) => (
              <Link
                key={item.anchor}
                href={`${homeHref}#${item.anchor}`}
                className="whitespace-nowrap rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <Badge
            variant="outline"
            className={cn(
              "ml-auto",
              audience === "owner"
                ? "border-emerald-700/30 text-emerald-800 dark:text-emerald-300"
                : "border-sky-700/30 text-sky-800 dark:text-sky-300"
            )}
          >
            {audience === "owner" ? "Owner Compass" : "Partner Compass"}
          </Badge>
        </div>
      </header>

      {children}
    </div>
  )
}
