"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu"
import {
  IconSettings,
  IconHistory,
  IconFilter,
  IconPlus,
  IconDots,
  IconDownload,
  IconUpload,
  IconPrinter,
} from "@tabler/icons-react"

interface ScheduleToolbarProps {
  onNewItem: () => void
}

export function ScheduleToolbar({ onNewItem }: ScheduleToolbarProps) {
  const [offlineMode, setOfflineMode] = useState(false)

  return (
    <div className="flex items-center justify-between gap-2 py-2 border-b mb-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="h-9">
            <IconDots className="size-4 mr-2" />
            Actions
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-48">
          <DropdownMenuItem>
            <IconSettings className="size-4 mr-2" />
            Settings
          </DropdownMenuItem>
          <DropdownMenuItem>
            <IconHistory className="size-4 mr-2" />
            Version History
          </DropdownMenuItem>
          <DropdownMenuItem>
            <IconFilter className="size-4 mr-2" />
            Filter Tasks
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuLabel className="text-xs font-normal text-muted-foreground px-2 py-1">
            Import & Export
          </DropdownMenuLabel>
          <DropdownMenuItem>
            <IconDownload className="size-4 mr-2" />
            Export Schedule
          </DropdownMenuItem>
          <DropdownMenuItem>
            <IconUpload className="size-4 mr-2" />
            Import Schedule
          </DropdownMenuItem>
          <DropdownMenuItem>
            <IconPrinter className="size-4 mr-2" />
            Print
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <div className="flex items-center justify-between px-2 py-1.5">
            <span className="text-sm">Schedule Offline</span>
            <Switch
              checked={offlineMode}
              onCheckedChange={setOfflineMode}
              className="scale-75"
            />
          </div>
        </DropdownMenuContent>
      </DropdownMenu>

      <Button size="sm" onClick={onNewItem} className="h-9">
        <IconPlus className="size-4 mr-2" />
        New Task
      </Button>
    </div>
  )
}
