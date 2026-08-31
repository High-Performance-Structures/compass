"use client"

import {
  IconArrowLeft,
  IconFiles,
  IconFolderOpen,
  IconUsers,
  IconClock,
  IconStar,
  IconTrash,
} from "@tabler/icons-react"
import Link from "next/link"
import { usePathname, useSearchParams } from "next/navigation"

import { useFilesOptional } from "@/hooks/use-files"
import { StorageIndicator } from "@/components/files/storage-indicator"
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import { cn } from "@/lib/utils"

type FileView =
  | "projects"
  | "my-files"
  | "shared"
  | "recent"
  | "starred"
  | "trash"

const fileNavItems: {
  title: string
  view: FileView
  icon: typeof IconFiles
}[] = [
  {
    title: "All Project Folders",
    view: "projects",
    icon: IconFolderOpen,
  },
  { title: "My Files", view: "my-files", icon: IconFiles },
  {
    title: "Shared with me",
    view: "shared",
    icon: IconUsers,
  },
  { title: "Recent", view: "recent", icon: IconClock },
  { title: "Starred", view: "starred", icon: IconStar },
  { title: "Trash", view: "trash", icon: IconTrash },
]

export function NavFiles() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const activeView =
    searchParams.get("view") ??
    (pathname && pathname !== "/dashboard/files"
      ? "my-files"
      : "projects")
  const files = useFilesOptional()
  const storageUsage = files?.storageUsage

  return (
    <>
      <SidebarGroup>
        <SidebarGroupContent>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                asChild
                tooltip="Back to Dashboard"
              >
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
            {fileNavItems.map(item => (
              <SidebarMenuItem key={item.view}>
                <SidebarMenuButton
                  asChild
                  tooltip={item.title}
                  className={cn(
                    activeView === item.view &&
                      pathname?.startsWith(
                        "/dashboard/files"
                      ) &&
                      "bg-sidebar-foreground/10 font-medium"
                  )}
                >
                  <Link
                    href={
                      item.view === "projects"
                        ? "/dashboard/files"
                        : item.view === "my-files"
                          ? "/dashboard/files?view=my-files"
                        : `/dashboard/files?view=${item.view}`
                    }
                  >
                    <item.icon />
                    <span>{item.title}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
      {storageUsage && (
        <div className="mt-auto px-3 pb-3">
          <StorageIndicator usage={storageUsage} />
        </div>
      )}
    </>
  )
}
