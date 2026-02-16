"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import {
  IconBuilding,
  IconCheck,
  IconChevronDown,
  IconUser,
} from "@tabler/icons-react"

import { getUserOrganizations, switchOrganization } from "@/app/actions/organizations"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

type OrgInfo = {
  readonly id: string
  readonly name: string
  readonly slug: string
  readonly type: string
  readonly role: string
}

export function OrgSwitcher({
  activeOrgId,
  activeOrgName,
}: {
  readonly activeOrgId: string | null
  readonly activeOrgName: string | null
}): React.ReactElement | null {
  const router = useRouter()
  const { isMobile } = useSidebar()
  const [orgs, setOrgs] = React.useState<readonly OrgInfo[]>([])
  const [isLoading, setIsLoading] = React.useState(false)

  React.useEffect(() => {
    async function loadOrgs(): Promise<void> {
      const result = await getUserOrganizations()
      setOrgs(result)
    }
    void loadOrgs()
  }, [])

  async function handleOrgSwitch(orgId: string): Promise<void> {
    if (orgId === activeOrgId) return

    setIsLoading(true)
    const result = await switchOrganization(orgId)

    if (result.success) {
      router.refresh()
    } else {
      console.error("Failed to switch organization:", result.error)
      setIsLoading(false)
    }
  }

  if (!activeOrgId || !activeOrgName) {
    return null
  }

  const activeOrg = orgs.find((org) => org.id === activeOrgId)
  const orgInitial = activeOrgName[0]?.toUpperCase() ?? "O"

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                {activeOrg?.type === "personal" ? (
                  <IconUser className="size-4" />
                ) : (
                  <IconBuilding className="size-4" />
                )}
              </div>
              <div className="flex min-w-0 flex-1 flex-col items-start text-left">
                <span className="truncate text-sm font-medium text-sidebar-foreground">
                  {activeOrgName}
                </span>
                {activeOrg && (
                  <span className="truncate text-xs text-sidebar-foreground/60">
                    {activeOrg.role}
                  </span>
                )}
              </div>
              <IconChevronDown className="ml-auto size-4 shrink-0 text-sidebar-foreground/60" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
            side={isMobile ? "bottom" : "right"}
            align="start"
            sideOffset={4}
          >
            <DropdownMenuLabel className="text-xs text-muted-foreground">
              Organizations
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {orgs.map((org) => {
              const isActive = org.id === activeOrgId
              const orgIcon =
                org.type === "personal" ? IconUser : IconBuilding

              return (
                <DropdownMenuItem
                  key={org.id}
                  onClick={() => void handleOrgSwitch(org.id)}
                  disabled={isLoading}
                  className={cn(
                    "flex items-center gap-2 px-2 py-1.5",
                    isActive && "bg-accent"
                  )}
                >
                  <div className="flex size-6 shrink-0 items-center justify-center rounded-md bg-muted">
                    {React.createElement(orgIcon, { className: "size-3" })}
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm font-medium">
                      {org.name}
                    </span>
                    <span className="truncate text-xs text-muted-foreground">
                      {org.role}
                    </span>
                  </div>
                  <Badge
                    variant="secondary"
                    className="shrink-0 text-[10px] font-normal"
                  >
                    {org.type}
                  </Badge>
                  {isActive && (
                    <IconCheck className="ml-1 size-4 shrink-0 text-primary" />
                  )}
                </DropdownMenuItem>
              )
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
