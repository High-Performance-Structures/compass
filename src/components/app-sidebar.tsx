"use client"

import * as React from "react"
import {
  IconAddressBook,
  IconActivity,
  IconCalculator,
  IconCalendarStats,
  IconClipboardCheck,
  IconTimeline,
  IconClipboardText,
  IconFiles,
  IconFileDollar,
  IconFileInvoice,
  IconFileText,
  IconEye,
  IconHeartHandshake,
  IconFolder,
  IconHome2,
  IconMailForward,
  IconMessageCircle,
  IconMessageCircleQuestion,
  IconMessageReport,
  IconPalette,
  IconPhone,
  IconPhoto,
  IconReceipt,
  IconShieldCheck,
  IconShoppingCart,
  IconShoppingCartQuestion,
  IconTemplate,
  IconUsers,
  IconVideo,
} from "@tabler/icons-react"
import { usePathname } from "next/navigation"

import {
  NavMain,
  type NavGroupChildItem,
  type NavItem,
  type NavLinkItem,
  type NavSubgroupChildItem,
} from "@/components/nav-main"
import { NavFiles } from "@/components/nav-files"
import { NavConversations } from "@/components/nav-conversations"
import { NavUser } from "@/components/nav-user"
import { OrgSwitcher } from "@/components/org-switcher"
import { VoicePanel } from "@/components/voice/voice-panel"
import { useActiveProject } from "@/components/project-list-provider"
// settings is now a page at /dashboard/settings
import { openFeedbackDialog } from "@/components/feedback-widget"
import { useVoiceState } from "@/hooks/use-voice-state"
import type { SidebarUser } from "@/lib/auth"
import { getSidebarContextMode } from "@/lib/sidebar-navigation"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"

const DASHBOARD_NAV: NavLinkItem = {
  kind: "link",
  title: "Dashboard",
  url: "/dashboard",
  icon: IconHome2,
}

const PLANNING_NAV: ReadonlyArray<NavLinkItem> = [
  {
    kind: "link",
    title: "To-Dos",
    url: "/dashboard/schedule?kind=task",
    icon: IconClipboardCheck,
  },
  {
    kind: "link",
    title: "Work Calendar",
    url: "/dashboard/schedule",
    icon: IconCalendarStats,
  },
  {
    kind: "link",
    title: "Project Schedule",
    url: "/dashboard/schedule?mode=projects&scope=all&view=gantt",
    icon: IconTimeline,
  },
]

interface SidebarNavLinkSource {
  readonly kind: "link"
  readonly title: string
  readonly url: string
  readonly icon: NonNullable<NavLinkItem["icon"]>
  readonly projectPath?: string
  readonly internalOnly?: boolean
  readonly adminOnly?: boolean
  readonly executiveAdminOnly?: boolean
}

interface SidebarNavSubgroupSource {
  readonly kind: "subgroup"
  readonly title: string
  readonly icon: NonNullable<NavLinkItem["icon"]>
  readonly items: ReadonlyArray<SidebarNavSubgroupChildSource>
}

interface SidebarNavComingSoonSource {
  readonly kind: "coming-soon"
  readonly title: string
  readonly note: string
  readonly icon: NonNullable<NavLinkItem["icon"]>
}

type SidebarNavSubgroupChildSource =
  | SidebarNavLinkSource
  | SidebarNavComingSoonSource

type SidebarNavGroupChildSource =
  | SidebarNavLinkSource
  | SidebarNavSubgroupSource

interface SidebarNavGroupSource {
  readonly title: string
  readonly icon: NonNullable<NavLinkItem["icon"]>
  readonly items: ReadonlyArray<SidebarNavGroupChildSource>
}

const NAV_GROUPS: ReadonlyArray<SidebarNavGroupSource> = [
  {
    title: "Projects",
    icon: IconFolder,
    items: [
      {
        kind: "link",
        title: "All Projects",
        url: "/dashboard/projects",
        icon: IconFolder,
      },
      {
        kind: "subgroup",
        title: "Updates & Logs",
        icon: IconClipboardText,
        items: [
          {
            kind: "link",
            title: "Owner Updates",
            url: "/dashboard/projects",
            icon: IconMailForward,
            projectPath: "/owner-updates",
          },
          {
            kind: "link",
            title: "Daily Logs",
            url: "/dashboard/projects",
            icon: IconClipboardText,
            projectPath: "/daily-logs",
          },
        ],
      },
      {
        kind: "subgroup",
        title: "Project Records",
        icon: IconFiles,
        items: [
          {
            kind: "link",
            title: "Photos",
            url: "/dashboard/projects",
            icon: IconPhoto,
            projectPath: "/photos",
          },
          {
            kind: "link",
            title: "Videos",
            url: "/dashboard/projects",
            icon: IconVideo,
            projectPath: "/videos",
          },
          {
            kind: "link",
            title: "Project Files",
            url: "/dashboard/files?view=projects",
            icon: IconFiles,
          },
          {
            kind: "link",
            title: "Contract Documents",
            url: "/dashboard/projects",
            icon: IconFileText,
            projectPath: "/contracts",
            internalOnly: true,
          },
          {
            kind: "link",
            title: "Project Contacts",
            url: "/dashboard/projects",
            icon: IconAddressBook,
            projectPath: "/contacts",
          },
          {
            kind: "link",
            title: "Warranty",
            url: "/dashboard/projects",
            icon: IconShieldCheck,
            projectPath: "/warranty",
          },
        ],
      },
      {
        kind: "subgroup",
        title: "Planning & Procurement",
        icon: IconPalette,
        items: [
          {
            kind: "link",
            title: "Project Schedule",
            url: "/dashboard/projects",
            icon: IconCalendarStats,
            projectPath: "/schedule",
          },
          {
            kind: "link",
            title: "Project To-Dos",
            url: "/dashboard/projects",
            icon: IconClipboardCheck,
            projectPath: "/todos",
          },
          {
            kind: "link",
            title: "Selections",
            url: "/dashboard/projects",
            icon: IconPalette,
            projectPath: "/selections",
          },
          {
            kind: "link",
            title: "RFIs",
            url: "/dashboard/rfis",
            icon: IconMessageCircleQuestion,
          },
          {
            kind: "link",
            title: "RFQs",
            url: "/dashboard/projects",
            icon: IconShoppingCartQuestion,
            projectPath: "/rfqs",
          },
        ],
      },
      {
        kind: "subgroup",
        title: "Project Financials",
        icon: IconReceipt,
        items: [
          {
            kind: "link",
            title: "Financial Overview",
            url: "/dashboard/financials",
            icon: IconReceipt,
          },
          {
            kind: "link",
            title: "Estimates",
            url: "/dashboard/projects",
            icon: IconCalculator,
            projectPath: "/estimate",
          },
          {
            kind: "link",
            title: "Project Budget",
            url: "/dashboard/projects",
            icon: IconFileDollar,
            projectPath: "/budget",
          },
          {
            kind: "link",
            title: "Bills & Pay Applications",
            url: "/dashboard/projects",
            icon: IconReceipt,
            projectPath: "/financials",
          },
          {
            kind: "link",
            title: "Purchase Orders",
            url: "/dashboard/purchase-orders",
            icon: IconShoppingCart,
          },
          {
            kind: "link",
            title: "Change Orders",
            url: "/dashboard/projects",
            icon: IconFileInvoice,
            projectPath: "/change-orders",
          },
        ],
      },
      {
        kind: "subgroup",
        title: "Collaboration & Access",
        icon: IconUsers,
        items: [
          {
            kind: "link",
            title: "Project Conversations",
            url: "/dashboard/projects",
            icon: IconMessageCircle,
            projectPath: "/conversations",
          },
          {
            kind: "link",
            title: "Owner Preview",
            url: "/dashboard/projects",
            icon: IconEye,
            projectPath: "/preview/owner",
          },
          {
            kind: "link",
            title: "Sub/Vendor Preview",
            url: "/dashboard/projects",
            icon: IconUsers,
            projectPath: "/preview/sub-vendor",
          },
        ],
      },
    ],
  },
  {
    title: "Communication",
    icon: IconMessageCircle,
    items: [
      {
        kind: "link",
        title: "Conversations",
        url: "/dashboard/conversations",
        icon: IconMessageCircle,
      },
      {
        kind: "link",
        title: "My Requests",
        url: "/dashboard/requests",
        icon: IconMessageReport,
      },
    ],
  },
  {
    title: "Office",
    icon: IconActivity,
    items: [
      {
        kind: "link",
        title: "Activity",
        url: "/dashboard/activity",
        icon: IconActivity,
        internalOnly: true,
      },
      {
        kind: "link",
        title: "Contacts",
        url: "/dashboard/contacts",
        icon: IconAddressBook,
      },
      {
        kind: "link",
        title: "Template Library",
        url: "/dashboard/templates",
        icon: IconTemplate,
        internalOnly: true,
      },
      {
        kind: "subgroup",
        title: "Executive Admin",
        icon: IconShieldCheck,
        items: [
          {
            kind: "link",
            title: "CHERISH Review",
            url: "/dashboard/executive-admin/cherish",
            icon: IconHeartHandshake,
            executiveAdminOnly: true,
          },
        ],
      },
      {
        kind: "link",
        title: "Feedback Desk",
        url: "/dashboard/requests/manage",
        icon: IconMessageReport,
        adminOnly: true,
      },
    ],
  },
]

function isNavLinkVisible(
  item: SidebarNavLinkSource,
  canViewActivity: boolean,
  canManageFeedback: boolean,
  canUseExecutiveAdmin: boolean,
): boolean {
  return (
    (!item.internalOnly || canViewActivity) &&
    (!item.adminOnly || canManageFeedback) &&
    (!item.executiveAdminOnly || canUseExecutiveAdmin)
  )
}

function resolveNavLink(
  item: SidebarNavLinkSource,
  activeProjectId: string | null,
): NavLinkItem {
  return {
    kind: "link",
    title: item.title,
    url:
      typeof item.projectPath === "string"
        ? activeProjectId
          ? `/dashboard/projects/${activeProjectId}${item.projectPath}`
          : `/dashboard/projects/select?target=${encodeURIComponent(
              item.projectPath.replace(/^\//, ""),
            )}`
        : item.url,
    icon: item.icon,
  }
}

function buildGroupChildren({
  items,
  activeProjectId,
  canViewActivity,
  canManageFeedback,
  canUseExecutiveAdmin,
}: {
  readonly items: ReadonlyArray<SidebarNavGroupChildSource>
  readonly activeProjectId: string | null
  readonly canViewActivity: boolean
  readonly canManageFeedback: boolean
  readonly canUseExecutiveAdmin: boolean
}): ReadonlyArray<NavGroupChildItem> {
  const children: NavGroupChildItem[] = []

  for (const item of items) {
    if (item.kind === "link") {
      if (
        isNavLinkVisible(
          item,
          canViewActivity,
          canManageFeedback,
          canUseExecutiveAdmin,
        )
      ) {
        children.push(resolveNavLink(item, activeProjectId))
      }
      continue
    }

    const subgroupLinks: NavSubgroupChildItem[] = []

    for (const child of item.items) {
      if (child.kind === "coming-soon") {
        subgroupLinks.push(child)
        continue
      }

      if (
        isNavLinkVisible(
          child,
          canViewActivity,
          canManageFeedback,
          canUseExecutiveAdmin,
        )
      ) {
        subgroupLinks.push(resolveNavLink(child, activeProjectId))
      }
    }

    if (subgroupLinks.length > 0) {
      children.push({
        kind: "subgroup",
        title: item.title,
        icon: item.icon,
        items: subgroupLinks,
      })
    }
  }

  return children
}

export function buildMainNavigation({
  activeProjectId,
  canViewActivity,
  canManageFeedback,
  canUseExecutiveAdmin,
}: {
  readonly activeProjectId: string | null
  readonly canViewActivity: boolean
  readonly canManageFeedback: boolean
  readonly canUseExecutiveAdmin: boolean
}): ReadonlyArray<NavItem> {
  return NAV_GROUPS.flatMap((group) => {
    const items = buildGroupChildren({
      items: group.items,
      activeProjectId,
      canViewActivity,
      canManageFeedback,
      canUseExecutiveAdmin,
    })

    return items.length > 0
      ? [{ kind: "group", title: group.title, icon: group.icon, items }]
      : []
  })
}

export function buildCherishNavigation(
  canUseFieldDesk: boolean,
): ReadonlyArray<NavLinkItem> {
  return canUseFieldDesk
    ? [
        {
          kind: "link",
          title: "CHERISH",
          url: "/dashboard/cherish",
          icon: IconHeartHandshake,
        },
      ]
    : []
}

function SidebarNav({
  canUseFieldDesk,
  canViewActivity,
  canManageFeedback,
  canUseExecutiveAdmin,
}: {
  readonly canUseFieldDesk: boolean
  readonly canViewActivity: boolean
  readonly canManageFeedback: boolean
  readonly canUseExecutiveAdmin: boolean
}) {
  const pathname = usePathname()
  const { state } = useSidebar()
  const isExpanded = state === "expanded"
  const { activeProjectId } = useActiveProject()
  const mode = getSidebarContextMode(pathname, isExpanded)

  const projectScopedPlanningNav = PLANNING_NAV.map((item) =>
    item.title === "To-Dos" && activeProjectId
      ? {
          ...item,
          url: `/dashboard/projects/${activeProjectId}/todos`,
        }
      : item
  )
  const navMain = buildMainNavigation({
    activeProjectId,
    canViewActivity,
    canManageFeedback,
    canUseExecutiveAdmin,
  })
  const staffMessageDeskNav: ReadonlyArray<NavLinkItem> = canViewActivity
    ? [
        {
          kind: "link",
          title: "Staff Message Desk",
          url: "/dashboard/office-maintenance/message-desk",
          icon: IconPhone,
        },
      ]
    : []
  const cherishNav = buildCherishNavigation(canUseFieldDesk)
  const persistentNav: ReadonlyArray<NavItem> = [
    DASHBOARD_NAV,
    ...staffMessageDeskNav,
    {
      kind: "group",
      title: "Planning",
      icon: IconCalendarStats,
      items: projectScopedPlanningNav,
    },
    ...cherishNav,
  ]

  return (
    <div key={mode} className="animate-in fade-in slide-in-from-left-1 flex flex-1 flex-col duration-150">
      <NavMain items={persistentNav} />
      {mode === "files" && (
        <React.Suspense>
          <NavFiles />
        </React.Suspense>
      )}
      {mode === "conversations" && (
        <React.Suspense>
          <NavConversations />
        </React.Suspense>
      )}
      {mode === "main" && (
        <NavMain items={navMain} />
      )}
    </div>
  )
}

export function AppSidebar({
  user,
  activeOrgId = null,
  activeOrgName = null,
  canUseFieldDesk = false,
  canViewActivity = false,
  canManageFeedback = false,
  canUseExecutiveAdmin = false,
  ...props
}: React.ComponentProps<typeof Sidebar> & {
  readonly user: SidebarUser | null
  readonly activeOrgId?: string | null
  readonly activeOrgName?: string | null
  readonly canUseFieldDesk?: boolean
  readonly canViewActivity?: boolean
  readonly canManageFeedback?: boolean
  readonly canUseExecutiveAdmin?: boolean
}) {
  const { isMobile } = useSidebar()
  const { channelId } = useVoiceState()
  const pathname = usePathname()

  if (pathname.startsWith("/dashboard/field")) return null

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <OrgSwitcher activeOrgId={activeOrgId} activeOrgName={activeOrgName} />
      </SidebarHeader>
      <SidebarContent className="compass-sidebar-scroll">
        <SidebarNav
          canUseFieldDesk={canUseFieldDesk}
          canViewActivity={canViewActivity}
          canManageFeedback={canManageFeedback}
          canUseExecutiveAdmin={canUseExecutiveAdmin}
        />
      </SidebarContent>
      <SidebarFooter className="border-t border-sidebar-border/60">
        {isMobile && (
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                onClick={openFeedbackDialog}
              >
                <IconMessageCircle />
                <span>Feedback</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        )}
        {channelId !== null && <VoicePanel />}
        <NavUser user={user} />
      </SidebarFooter>
    </Sidebar>
  )
}
