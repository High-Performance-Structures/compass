"use client"

import * as React from "react"
import { cn } from "@/lib/utils"

interface Tab {
  id: string
  label: string
  count?: number
}

interface DashboardTabsProps {
  tabs: Tab[]
  activeTab: string
  onTabChange: (tabId: string) => void
  className?: string
}

export function DashboardTabs({
  tabs,
  activeTab,
  onTabChange,
  className,
}: DashboardTabsProps) {
  return (
    <div className={cn("border-b", className)}>
      <div className="flex overflow-x-auto px-2 md:px-4 [&::-webkit-scrollbar]:hidden">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            className={cn(
              "relative shrink-0 px-4 py-3 text-sm font-medium transition-colors",
              "hover:text-foreground",
              activeTab === tab.id
                ? "text-foreground"
                : "text-muted-foreground"
            )}
            onClick={() => onTabChange(tab.id)}
          >
            <span className="flex items-center gap-2">
              {tab.label}
              {tab.count !== undefined && (
                <span className="rounded-full bg-muted px-1.5 py-0.5 text-xs tabular-nums">
                  {tab.count}
                </span>
              )}
            </span>
            {activeTab === tab.id && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />
            )}
          </button>
        ))}
      </div>
    </div>
  )
}
