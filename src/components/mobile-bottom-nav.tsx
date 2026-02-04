"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  IconHome,
  IconHomeFilled,
  IconFolder,
  IconFolderFilled,
  IconUsers,
  IconUsersGroup,
  IconFile,
  IconFileFilled,
} from "@tabler/icons-react"
import { cn } from "@/lib/utils"

interface NavItemProps {
  href: string
  icon: React.ReactNode
  activeIcon: React.ReactNode
  label: string
  isActive: boolean
}

function NavItem({
  href,
  icon,
  activeIcon,
  label,
  isActive,
}: NavItemProps) {
  return (
    <Link
      href={href}
      className="flex flex-col items-center justify-center gap-0.5"
    >
      <div
        className={cn(
          "flex h-7 w-14 items-center justify-center",
          "rounded-full transition-colors duration-200",
          isActive ? "bg-primary/12" : "bg-transparent"
        )}
      >
        <span
          className={cn(
            isActive
              ? "text-primary"
              : "text-muted-foreground"
          )}
        >
          {isActive ? activeIcon : icon}
        </span>
      </div>
      <span
        className={cn(
          "text-[11px] leading-tight",
          isActive
            ? "font-semibold text-primary"
            : "font-medium text-muted-foreground"
        )}
      >
        {label}
      </span>
    </Link>
  )
}

export function MobileBottomNav() {
  const pathname = usePathname()

  const isActive = (path: string) => {
    if (path === "/dashboard") return pathname === "/dashboard"
    return pathname.startsWith(path)
  }

  return (
    <nav
      className={cn(
        "fixed bottom-0 left-0 right-0 z-50 md:hidden",
        "border-t bg-background"
      )}
    >
      <div className="grid h-14 grid-cols-4 items-center pb-[env(safe-area-inset-bottom)]">
        <NavItem
          href="/dashboard"
          icon={<IconHome className="size-[22px]" />}
          activeIcon={<IconHomeFilled className="size-[22px]" />}
          label="Home"
          isActive={isActive("/dashboard")}
        />
        <NavItem
          href="/dashboard/projects"
          icon={<IconFolder className="size-[22px]" />}
          activeIcon={
            <IconFolderFilled className="size-[22px]" />
          }
          label="Projects"
          isActive={isActive("/dashboard/projects")}
        />
        <NavItem
          href="/dashboard/people"
          icon={<IconUsers className="size-[22px]" />}
          activeIcon={
            <IconUsersGroup className="size-[22px]" />
          }
          label="People"
          isActive={isActive("/dashboard/people")}
        />
        <NavItem
          href="/dashboard/files"
          icon={<IconFile className="size-[22px]" />}
          activeIcon={
            <IconFileFilled className="size-[22px]" />
          }
          label="Files"
          isActive={isActive("/dashboard/files")}
        />
      </div>
    </nav>
  )
}
