"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  IconHome,
  IconHomeFilled,
  IconFolder,
  IconFolderFilled,
  IconSettings,
  IconSettingsFilled,
  IconFile,
  IconFileFilled,
  IconBriefcase,
  IconHeartHandshake,
} from "@tabler/icons-react"
import { useNativePlatform } from "@/hooks/use-native"
import { fieldModeUrl } from "@/lib/native/field-mode-url"
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
          "rounded-md transition-colors duration-200",
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

export function MobileBottomNav({
  canUseFieldDesk = false,
}: {
  readonly canUseFieldDesk?: boolean
}) {
  const pathname = usePathname()
  const nativePlatform = useNativePlatform()

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
      <div
        className={cn(
          "grid h-14 items-center pb-[env(safe-area-inset-bottom)]",
          canUseFieldDesk ? "grid-cols-5" : "grid-cols-4",
        )}
      >
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
        {canUseFieldDesk && (
          <NavItem
            href={fieldModeUrl(nativePlatform)}
            icon={
              nativePlatform === "web" ? (
                <IconHeartHandshake className="size-[22px]" />
              ) : (
                <IconBriefcase className="size-[22px]" />
              )
            }
            activeIcon={
              nativePlatform === "web" ? (
                <IconHeartHandshake className="size-[22px]" />
              ) : (
                <IconBriefcase className="size-[22px]" />
              )
            }
            label={nativePlatform === "web" ? "CHERISH" : "Field"}
            isActive={
              nativePlatform === "web" && isActive("/dashboard/field")
            }
          />
        )}
        <NavItem
          href="/dashboard/settings"
          icon={<IconSettings className="size-[22px]" />}
          activeIcon={
            <IconSettingsFilled className="size-[22px]" />
          }
          label="Settings"
          isActive={isActive("/dashboard/settings")}
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
