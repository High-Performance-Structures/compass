"use client"

import * as React from "react"
import Image from "next/image"
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
import { cn } from "@/lib/utils"

type OrgInfo = {
  readonly id: string
  readonly name: string
  readonly slug: string
  readonly type: string
  readonly role: string
}

const LEGAL_COMPANY_NAME = "High Performance Structures Inc."
const INTERNAL_COMPANY_ALIASES: readonly string[] = [
  "hps",
  "high performance structures",
  "high performance structures inc",
  "open range construction",
  "open range construction ltd",
]

function normalizeCompanyLabel(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[.,]/g, "")
    .replace(/\s+/g, " ")
}

function organizationDisplayName(org: {
  readonly name: string | null
  readonly slug?: string
  readonly type?: string
}): string {
  const name = org.name ?? "Compass"
  const normalizedName = normalizeCompanyLabel(name)
  const normalizedSlug = normalizeCompanyLabel(org.slug ?? "")
  const isInternalCompany =
    org.type === "internal" ||
    INTERNAL_COMPANY_ALIASES.includes(normalizedName) ||
    INTERNAL_COMPANY_ALIASES.includes(normalizedSlug)

  return isInternalCompany ? LEGAL_COMPANY_NAME : name
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

  const activeOrg = orgs.find((org) => org.id === activeOrgId)
  const displayName = organizationDisplayName({
    name: activeOrgName,
    slug: activeOrg?.slug,
    type: activeOrg?.type,
  })
  const hasOrgs = orgs.length > 1

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <div
          data-slot="sidebar-menu-button"
          data-sidebar="menu-button"
          data-size="lg"
          data-active={false}
          className={cn(
            "peer/menu-button flex h-12 w-full items-center gap-0 overflow-visible rounded-none px-0 text-left text-sm outline-hidden ring-sidebar-ring transition-[width,height,padding]",
            "group-data-[collapsible=icon]:size-9! group-data-[collapsible=icon]:justify-center! group-data-[collapsible=icon]:gap-0! group-data-[collapsible=icon]:p-2! group-data-[collapsible=icon]:[&>*:nth-child(n+2)]:hidden",
            "[data-mobile=true]_&:h-14 [data-mobile=true]_&:text-base",
          )}
        >
          <Link
            href="/dashboard"
            className="flex size-9 shrink-0 items-center justify-center transition-transform hover:scale-[1.03]"
            aria-label="Compass home"
          >
            <Image
              src="/department-logos/hps-h-green.svg"
              alt="HPS"
              width={36}
              height={36}
              className="size-9 rounded-[5px] object-contain"
              priority
              unoptimized
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
                        {organizationDisplayName(org)}
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
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
