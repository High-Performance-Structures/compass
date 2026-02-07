"use client"

import { IconLayoutDashboard } from "@tabler/icons-react"
import Link from "next/link"

import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"

interface Dashboard {
  readonly id: string
  readonly name: string
}

export function NavDashboards({
  dashboards,
}: {
  readonly dashboards: ReadonlyArray<Dashboard>
}) {
  if (dashboards.length === 0) return null

  return (
    <SidebarGroup>
      <SidebarGroupLabel>Dashboards</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {dashboards.map((d) => (
            <SidebarMenuItem key={d.id}>
              <SidebarMenuButton
                asChild
                tooltip={d.name}
              >
                <Link href={`/dashboard/boards/${d.id}`}>
                  <IconLayoutDashboard />
                  <span>{d.name}</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}
