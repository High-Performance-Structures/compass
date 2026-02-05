"use client"

import * as React from "react"
import { usePathname, useRouter } from "next/navigation"
import { useTheme } from "next-themes"
import { toast } from "sonner"
import {
  ArrowLeft,
  ArrowRight,
  Copy,
  Search,
  Sun,
  Moon,
  MessageCircle,
  LayoutDashboard,
  FolderKanban,
  Users,
  FolderOpen,
  UserRound,
  Building2,
  DollarSign,
} from "lucide-react"

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import { usePageActionsContext } from "@/components/page-actions-provider"
import { useCommandMenu } from "@/components/command-menu-provider"
import { useFeedback } from "@/components/feedback-widget"

const NAV_ITEMS = [
  {
    label: "Dashboard",
    href: "/dashboard",
    icon: LayoutDashboard,
  },
  {
    label: "Projects",
    href: "/dashboard/projects",
    icon: FolderKanban,
  },
  {
    label: "People",
    href: "/dashboard/people",
    icon: Users,
  },
  {
    label: "Files",
    href: "/dashboard/files",
    icon: FolderOpen,
  },
  {
    label: "Customers",
    href: "/dashboard/customers",
    icon: UserRound,
  },
  {
    label: "Vendors",
    href: "/dashboard/vendors",
    icon: Building2,
  },
  {
    label: "Financials",
    href: "/dashboard/financials",
    icon: DollarSign,
  },
] as const

export function DashboardContextMenu({
  children,
}: {
  readonly children: React.ReactNode
}) {
  const pathname = usePathname()
  const router = useRouter()
  const { theme, setTheme } = useTheme()
  const { actions: pageActions } = usePageActionsContext()
  const { open: openCommandMenu } = useCommandMenu()
  const { open: openFeedback } = useFeedback()

  const handleCopyUrl = () => {
    navigator.clipboard.writeText(window.location.href).then(
      () => toast.success("URL copied to clipboard"),
      () => toast.error("Failed to copy URL")
    )
  }

  const isCurrentRoute = (href: string): boolean => {
    if (href === "/dashboard") return pathname === "/dashboard"
    return pathname.startsWith(href)
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent className="w-56">
        <ContextMenuItem onSelect={() => window.history.back()}>
          <ArrowLeft />
          Back
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => window.history.forward()}>
          <ArrowRight />
          Forward
        </ContextMenuItem>

        {pageActions.length > 0 && (
          <>
            <ContextMenuSeparator />
            <ContextMenuLabel>Page Actions</ContextMenuLabel>
            {pageActions.map((action) => (
              <ContextMenuItem
                key={action.id}
                onSelect={action.onSelect}
              >
                {action.icon &&
                  React.createElement(action.icon)}
                {action.label}
              </ContextMenuItem>
            ))}
          </>
        )}

        <ContextMenuSeparator />
        <ContextMenuItem onSelect={handleCopyUrl}>
          <Copy />
          Copy Page URL
        </ContextMenuItem>
        <ContextMenuItem onSelect={openCommandMenu}>
          <Search />
          Command Menu
          <ContextMenuShortcut>
            {"\u2318"}K
          </ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem
          onSelect={() =>
            setTheme(theme === "dark" ? "light" : "dark")
          }
        >
          {theme === "dark" ? <Sun /> : <Moon />}
          Toggle Theme
        </ContextMenuItem>
        <ContextMenuItem onSelect={openFeedback}>
          <MessageCircle />
          Send Feedback
        </ContextMenuItem>

        <ContextMenuSeparator />
        <ContextMenuSub>
          <ContextMenuSubTrigger>
            Navigate to...
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className="w-48">
            {NAV_ITEMS.map((item) => (
              <ContextMenuItem
                key={item.href}
                disabled={isCurrentRoute(item.href)}
                onSelect={() => router.push(item.href)}
              >
                <item.icon />
                {item.label}
              </ContextMenuItem>
            ))}
          </ContextMenuSubContent>
        </ContextMenuSub>
      </ContextMenuContent>
    </ContextMenu>
  )
}
