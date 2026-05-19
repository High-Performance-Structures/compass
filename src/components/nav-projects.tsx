"use client"

import { IconArrowLeft, IconFolder } from "@tabler/icons-react"
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

function projectDisplay(project: ProjectListItem): string {
  return project.projectNumber ?? project.name
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

  return (
    <>
      <SidebarGroup>
        <SidebarGroupContent>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton asChild tooltip="Back to Dashboard">
                <Link href="/dashboard">
                  <IconArrowLeft />
                  <span>Back</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
      <SidebarGroup>
        <SidebarGroupContent>
          <SidebarMenu>
            {projects.length === 0 ? (
              <SidebarMenuItem>
                <SidebarMenuButton disabled>
                  <IconFolder />
                  <span className="text-muted-foreground">
                    No projects
                  </span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ) : (
              projects.map((project) => (
                <SidebarMenuItem key={project.id}>
                  <SidebarMenuButton
                    asChild
                    tooltip={`${projectDisplay(project)} - ${project.name}`}
                    className={cn(
                      activeId === project.id &&
                        "bg-sidebar-foreground/10 font-medium"
                    )}
                  >
                    <Link href={`/dashboard/projects/${project.id}`}>
                      <IconFolder />
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate">
                          {projectDisplay(project)}
                        </span>
                        {project.projectNumber && (
                          <span className="truncate text-xs text-muted-foreground">
                            {project.name}
                          </span>
                        )}
                      </span>
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
