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
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"
import { CompassMark } from "@/components/compass-mark"
import { cn } from "@/lib/utils"

type OrgInfo = {
  readonly id: string
  readonly name: string
  readonly slug: string
  readonly type: string
  readonly role: string
}

const COMPASS_COMPANY_NAME = "High Performance Structures Inc."

function sidebarCompanyName(activeOrgName: string | null): string {
  // Project department branding belongs in project documents. It must never
  // replace the main Compass company identity in global navigation.
  if (
    activeOrgName === null ||
    activeOrgName === "Open Range Construction" ||
    activeOrgName === "Open Range Construction, Ltd." ||
    activeOrgName.startsWith("High Performance Structures")
  ) {
    return COMPASS_COMPANY_NAME
  }
  return activeOrgName
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

  const displayName = sidebarCompanyName(activeOrgName)
  const hasOrgs = orgs.length > 1

  // The header names the product; the company line (without the legal
  // suffix) doubles as the organization switcher when there is a choice.
  const companyLine = displayName.replace(/,?\s+Inc\.?$/i, "").toUpperCase()

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <div className="flex items-center gap-3 px-1 py-1 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
          <Link
            href="/dashboard"
            aria-label="Compass home"
            className="shrink-0 text-sidebar-foreground transition-transform hover:scale-[1.03]"
          >
            <CompassMark className="size-8" />
          </Link>
          <div className="flex min-w-0 flex-col gap-0.5 group-data-[collapsible=icon]:hidden">
            <Link
              href="/dashboard"
              className="text-base font-semibold uppercase tracking-[0.32em] text-sidebar-foreground"
            >
              Compass
            </Link>
            <DropdownMenu>
              <DropdownMenuTrigger asChild disabled={!hasOrgs}>
                <button
                  type="button"
                  aria-label={hasOrgs ? `${displayName}, switch organization` : displayName}
                  className={cn(
                    "flex min-w-0 items-center gap-1 rounded-sm text-left font-mono text-xs tracking-[0.16em] text-sidebar-foreground/60",
                    hasOrgs ? "hover:text-sidebar-foreground" : "cursor-default",
                  )}
                >
                  <span className="truncate">{companyLine}</span>
                  {hasOrgs ? <IconSelector className="size-3 shrink-0 opacity-60" aria-hidden="true" /> : null}
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
        </div>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
