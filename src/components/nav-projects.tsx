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

export function NavProjects({
  projects,
}: {
  projects: { id: string; name: string }[]
}) {
  const pathname = usePathname()
  const activeId = pathname?.match(
    /^\/dashboard\/projects\/([^/]+)/
  )?.[1]
  const inScheduleContext = pathname?.includes("/schedule")

  const getProjectHref = (projectId: string) =>
    inScheduleContext
      ? `/dashboard/projects/${projectId}/schedule`
      : `/dashboard/projects/${projectId}`

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
                    tooltip={project.name}
                    className={cn(
                      activeId === project.id &&
                        "bg-sidebar-foreground/10 font-medium"
                    )}
                  >
                    <Link href={getProjectHref(project.id)}>
                      <IconFolder />
                      <span className="truncate">
                        {project.name}
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
