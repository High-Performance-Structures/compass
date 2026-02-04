"use client"

import { IconDotsVertical } from "@tabler/icons-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

export interface MobileListCardAction {
  label: string
  onClick: () => void
  destructive?: boolean
}

interface MobileListCardProps {
  avatar?: React.ReactNode
  title: string
  subtitle?: string
  metadata?: string[]
  actions?: MobileListCardAction[]
  onClick?: () => void
}

export function MobileListCard({
  avatar,
  title,
  subtitle,
  metadata,
  actions,
  onClick,
}: MobileListCardProps) {
  return (
    <div
      className="flex items-start gap-3 border-b p-3 active:bg-muted/50"
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      {avatar && (
        <div className="size-10 shrink-0">
          {avatar}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium text-sm">{title}</p>
            {subtitle && (
              <p className="truncate text-sm text-muted-foreground">
                {subtitle}
              </p>
            )}
          </div>
          {actions && actions.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 shrink-0"
                  onClick={(e) => e.stopPropagation()}
                >
                  <IconDotsVertical className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {actions.map((action) => (
                  <DropdownMenuItem
                    key={action.label}
                    onClick={(e) => {
                      e.stopPropagation()
                      action.onClick()
                    }}
                    className={action.destructive ? "text-destructive" : undefined}
                  >
                    {action.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
        {metadata && metadata.length > 0 && (
          <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
            {metadata.map((item, i) => (
              <span key={i} className="flex items-center gap-2">
                {i > 0 && <span>·</span>}
                <span>{item}</span>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
