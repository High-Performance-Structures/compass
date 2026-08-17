"use client"

import Link from "next/link"
import { useState } from "react"
import {
  IconDatabase,
  IconMailForward,
  IconSettings,
  IconTemplate,
} from "@tabler/icons-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"

type OfficeMaintenanceProject = Readonly<{
  status: string
  projectNumber: string | null
  googleDriveFolderId: string | null
}>

function statusNeedsCleanup(status: string): boolean {
  const normalized = status
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
  if ([
    "open",
    "active",
    "current",
    "construction",
    "in progress",
    "scheduled",
    "preconstruction",
  ].includes(normalized)) {
    return false
  }
  if (normalized.includes("warranty") || normalized.includes("service")) {
    return false
  }
  return !["closed", "complete", "completed"].includes(normalized)
}

function needsDepartment(projectNumber: string | null): boolean {
  const prefix = projectNumber?.trim().slice(0, 1).toUpperCase()
  return prefix !== "O" && prefix !== "H" && prefix !== "N" && prefix !== "D"
}

function setupError(value: unknown): string | null {
  if (typeof value !== "object" || value === null || !("error" in value)) {
    return null
  }
  return typeof value.error === "string" ? value.error : null
}

export function OfficeMaintenanceDrawer({
  projects,
}: {
  readonly projects: readonly OfficeMaintenanceProject[]
}): React.ReactElement {
  const [isConnectingGoto, setIsConnectingGoto] = useState(false)
  const [isGotoConnected, setIsGotoConnected] = useState(false)
  const statusCleanupCount = projects.filter((project) =>
    statusNeedsCleanup(project.status)
  ).length
  const driveLinkedCount = projects.filter(
    (project) => project.googleDriveFolderId !== null
  ).length
  const departmentNeededCount = projects.filter((project) =>
    needsDepartment(project.projectNumber)
  ).length

  async function connectGotoMessaging(): Promise<void> {
    setIsConnectingGoto(true)
    try {
      const response = await fetch("/api/integrations/goto/setup", {
        method: "POST",
        credentials: "same-origin",
      })
      const result: unknown = await response.json()
      if (!response.ok) {
        toast.error(setupError(result) ?? "Could not connect GoTo messaging.")
        return
      }
      setIsGotoConnected(true)
      toast.success("GoTo messaging is connected to Compass.")
    } catch {
      toast.error("Could not connect GoTo messaging.")
    } finally {
      setIsConnectingGoto(false)
    }
  }

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm">
          <IconSettings className="size-4" />
          Office maintenance
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Office maintenance</SheetTitle>
          <SheetDescription>
            Project registry cleanup and integration housekeeping.
          </SheetDescription>
        </SheetHeader>
        <div className="divide-y border-y px-4">
          <div className="flex items-center justify-between py-4 text-sm">
            <span>Statuses needing cleanup</span>
            <strong>{statusCleanupCount}</strong>
          </div>
          <div className="flex items-center justify-between py-4 text-sm">
            <span>Drive-linked projects</span>
            <strong>{driveLinkedCount}</strong>
          </div>
          <div className="flex items-center justify-between py-4 text-sm">
            <span>Department assignment needed</span>
            <strong>{departmentNeededCount}</strong>
          </div>
        </div>
        <div className="space-y-2 px-4">
          <Button asChild variant="outline" className="w-full justify-start">
            <Link href="/dashboard/office-maintenance/inbound-email">
              <IconMailForward className="size-4" />
              Review inbound messages
            </Link>
          </Button>
          <Button asChild variant="outline" className="w-full justify-start">
            <Link href="/dashboard/office-maintenance/buildertrend-cutover">
              <IconDatabase className="size-4" />
              Buildertrend cutover coverage
            </Link>
          </Button>
          <div className="space-y-2 border p-3">
            <div>
              <p className="text-sm font-medium">GoTo text routing</p>
              <p className="text-xs text-muted-foreground">
                Connect inbound staff and project texts to Compass activities.
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              className="w-full"
              disabled={isConnectingGoto || isGotoConnected}
              onClick={connectGotoMessaging}
            >
              {isGotoConnected
                ? "GoTo messaging connected"
                : isConnectingGoto
                  ? "Connecting GoTo…"
                  : "Connect GoTo messaging"}
            </Button>
          </div>
          <Button asChild variant="outline" className="w-full">
            <Link href="/dashboard/templates">
              <IconTemplate className="size-4" />
              Open Template Library
            </Link>
          </Button>
          <Button asChild className="w-full">
            <Link href="/dashboard/projects?manage=1">
              Open advanced registry tools
            </Link>
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}
