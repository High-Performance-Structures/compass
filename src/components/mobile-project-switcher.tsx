"use client"

import * as React from "react"
import { usePathname, useRouter } from "next/navigation"
import {
  IconChevronDown,
  IconFolder,
  IconCheck,
} from "@tabler/icons-react"
import { cn } from "@/lib/utils"
import { useProjectList } from "@/components/project-list-provider"
import { useIsMobile } from "@/hooks/use-mobile"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"

interface MobileProjectSwitcherProps {
  projectName: string
  projectNumber?: string | null
  projectId: string
  status?: string
}

function projectSectionHref(
  pathname: string | null,
  projectId: string
): string {
  const baseHref = `/dashboard/projects/${projectId}`
  const suffix = pathname?.replace(/^\/dashboard\/projects\/[^/]+/, "") ?? ""
  const section = suffix.split("/").filter(Boolean)[0]

  switch (section) {
    case "budget":
    case "contacts":
    case "daily-logs":
    case "financials":
    case "owner-updates":
    case "photos":
    case "purchase-orders":
    case "rfis":
    case "schedule":
      return `${baseHref}/${section}`
    default:
      return baseHref
  }
}

export function MobileProjectSwitcher({
  projectName,
  projectNumber = null,
  projectId,
  status,
}: MobileProjectSwitcherProps) {
  const isMobile = useIsMobile()
  const router = useRouter()
  const pathname = usePathname()
  const projects = useProjectList()
  const [open, setOpen] = React.useState(false)
  const displayName = projectNumber ?? projectName

  // on desktop or single project, just render name normally
  if (!isMobile || projects.length < 2) {
    return (
      <div className="flex flex-wrap items-center gap-2 sm:gap-3 mb-1">
        <div>
          <h1 className="text-2xl font-semibold">
            {displayName}
          </h1>
          {projectNumber && (
            <p className="text-sm text-muted-foreground">
              {projectName}
            </p>
          )}
        </div>
        {status && (
          <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-primary/10 text-primary">
            {status}
          </span>
        )}
      </div>
    )
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="text-left mb-1 active:opacity-70"
      >
        <span className="text-2xl font-semibold">
          {displayName}
        </span>
        <IconChevronDown className="size-4 text-muted-foreground inline ml-1 -mt-0.5 align-middle" />
        {projectNumber && (
          <span className="block text-sm text-muted-foreground">
            {projectName}
          </span>
        )}
      </button>
      {status && (
        <div>
          <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-primary/10 text-primary">
            {status}
          </span>
        </div>
      )}

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="bottom"
          className="p-0"
          showClose={false}
        >
          <SheetHeader className="border-b px-4 py-3 text-left">
            <SheetTitle className="text-base font-medium">
              Projects
            </SheetTitle>
          </SheetHeader>
          <div className="max-h-[60vh] overflow-y-auto py-1">
            {projects.map((project) => {
              const isActive = project.id === projectId
              return (
                <button
                  key={project.id}
                  className={cn(
                    "flex w-full items-center gap-3",
                    "px-4 py-3 text-left",
                    "active:bg-muted/50",
                    isActive && "bg-muted/30"
                  )}
                  onClick={() => {
                    setOpen(false)
                    if (!isActive) {
                      router.push(
                        projectSectionHref(pathname, project.id)
                      )
                    }
                  }}
                >
                  <IconFolder
                    className={cn(
                      "size-5 shrink-0",
                      isActive
                        ? "text-primary"
                        : "text-muted-foreground"
                    )}
                  />
                  <span className="min-w-0 flex-1">
                    <span
                      className={cn(
                        "block truncate text-sm",
                        isActive && "font-medium"
                      )}
                    >
                      {project.projectNumber ?? project.name}
                    </span>
                    {project.projectNumber && (
                      <span className="block truncate text-xs text-muted-foreground">
                        {project.name}
                      </span>
                    )}
                  </span>
                  {isActive && (
                    <IconCheck className="size-4 text-primary shrink-0" />
                  )}
                </button>
              )
            })}
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}
