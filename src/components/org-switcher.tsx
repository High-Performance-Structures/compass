"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  IconBuilding,
  IconCheck,
  IconSelector,
  IconUser,
} from "@tabler/icons-react"

import {
  getUserOrganizations,
  switchOrganization,
} from "@/app/actions/organizations"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"
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
}): React.ReactElement {
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

  const displayName = activeOrgName ?? "Compass"
  const hasOrgs = orgs.length > 1

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton
          size="lg"
          className="gap-0 px-0 hover:bg-transparent active:bg-transparent"
          asChild
        >
          <div className="w-full justify-start">
            <Link
              href="/dashboard"
              className="flex shrink-0 items-center justify-center size-8 rounded-md hover:bg-sidebar-accent transition-colors"
              aria-label="Compass home"
            >
              <span
                className="!size-5 block bg-current"
                style={{
                  maskImage: "url(/logo-black.png)",
                  maskSize: "contain",
                  maskRepeat: "no-repeat",
                  WebkitMaskImage: "url(/logo-black.png)",
                  WebkitMaskSize: "contain",
                  WebkitMaskRepeat: "no-repeat",
                }}
              />
            </Link>
            <DropdownMenu>
              <DropdownMenuTrigger asChild disabled={!hasOrgs}>
                <button
                  className={cn(
                    "flex min-w-0 flex-1 items-center gap-1 rounded-md px-2 py-1 text-left",
                    "hover:bg-sidebar-accent transition-colors",
                    "data-[state=open]:bg-sidebar-accent",
                    "data-[state=open]:text-sidebar-accent-foreground",
                    !hasOrgs && "cursor-default hover:bg-transparent",
                  )}
                >
                  <span className="truncate text-sm font-semibold">
                    {displayName}
                  </span>
                  {hasOrgs && (
                    <IconSelector
                      className="size-4 shrink-0 opacity-50"
                    />
                  )}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
                side={isMobile ? "bottom" : "right"}
                align="start"
                sideOffset={4}
              >
                {orgs.map((org, i) => {
                  const isActive = org.id === activeOrgId
                  const OrgIcon =
                    org.type === "personal" ? IconUser : IconBuilding

                  return (
                    <React.Fragment key={org.id}>
                      {i > 0 && <DropdownMenuSeparator />}
                      <DropdownMenuItem
                        onClick={() => void handleOrgSwitch(org.id)}
                        disabled={isLoading}
                        className="gap-2 px-2 py-1.5"
                      >
                        <OrgIcon className="size-4 shrink-0 opacity-60" />
                        <span className="truncate font-medium">
                          {org.name}
                        </span>
                        {isActive && (
                          <IconCheck
                            className="ml-auto size-4 shrink-0 text-primary"
                          />
                        )}
                      </DropdownMenuItem>
                    </React.Fragment>
                  )
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
