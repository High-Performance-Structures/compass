"use client"

import * as React from "react"
import { usePathname, useRouter } from "next/navigation"
import { IconCalendarStats, IconClipboardText, IconListCheck, IconMessageCircle, IconMessageQuestion, IconPlus } from "@tabler/icons-react"
import { ProjectCombobox } from "@/components/projects/project-combobox"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { QUICK_ADD_ACTIONS, QUICK_ADD_ACTION_LABELS, type QuickAddAction, type QuickAddProject } from "@/lib/quick-add"

const QuickAddContext = React.createContext<readonly QuickAddProject[]>([])

export function QuickAddProvider({ projects, children }: {
  readonly projects: readonly QuickAddProject[]
  readonly children: React.ReactNode
}): React.ReactElement {
  return <QuickAddContext.Provider value={projects}>{children}</QuickAddContext.Provider>
}

function ActionIcon({ action }: { readonly action: QuickAddAction }): React.ReactElement {
  switch (action) {
    case "message": return <IconMessageCircle className="size-4" />
    case "daily-log": return <IconClipboardText className="size-4" />
    case "schedule-item": return <IconCalendarStats className="size-4" />
    case "todo": return <IconListCheck className="size-4" />
    case "rfi": return <IconMessageQuestion className="size-4" />
  }
}

export function QuickAddMenu(): React.ReactElement | null {
  const router = useRouter()
  const pathname = usePathname()
  const projects = React.useContext(QuickAddContext)
  const [pendingAction, setPendingAction] = React.useState<QuickAddAction | null>(null)
  const [selectedProjectId, setSelectedProjectId] = React.useState("")
  const actions = QUICK_ADD_ACTIONS.filter((action) => projects.some((project) => project.actions.some((entry) => entry.action === action)))
  const eligibleProjects = projects.filter((project) => project.actions.some((entry) => entry.action === pendingAction))
  const selectedProject = eligibleProjects.find((project) => project.id === selectedProjectId)
  const selectedDestination = selectedProject?.actions.find((entry) => entry.action === pendingAction)

  function closePicker(): void {
    setPendingAction(null)
    setSelectedProjectId("")
  }

  function chooseAction(action: QuickAddAction): void {
    const eligible = projects.filter((project) => project.actions.some((entry) => entry.action === action))
    const currentProject = eligible.find((project) => pathname.includes(`/projects/${encodeURIComponent(project.id)}/`) || pathname.endsWith(`/projects/${encodeURIComponent(project.id)}`))
    setSelectedProjectId(currentProject?.id ?? (eligible.length === 1 ? eligible[0]?.id ?? "" : ""))
    setPendingAction(action)
  }

  function continueToProject(inbox = false): void {
    if (!selectedDestination || !pendingAction) return
    const destination = new URL(selectedDestination.href, window.location.origin)
    if (inbox) destination.searchParams.delete("quickAdd")
    closePicker()
    if (!inbox && destination.pathname === pathname) {
      // Reopen the current workflow without remounting or dropping an existing draft.
      window.dispatchEvent(new CustomEvent("compass:quick-add", { detail: { action: pendingAction } }))
      return
    }
    router.push(`${destination.pathname}${destination.search}${destination.hash}`)
  }

  if (actions.length === 0) return null

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="h-9 shrink-0 gap-1.5 px-2 text-muted-foreground hover:bg-accent hover:text-accent-foreground" aria-label="Quick Add" title="Quick Add" data-quick-add-trigger>
            <IconPlus className="size-4" />
            <span className="hidden lg:inline">Quick Add</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel>Quick Add</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {actions.map((action) => (
            <DropdownMenuItem key={action} onSelect={() => chooseAction(action)} data-quick-add-action={action}>
              <ActionIcon action={action} />{QUICK_ADD_ACTION_LABELS[action]}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={pendingAction !== null} onOpenChange={(open) => { if (!open) closePicker() }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{pendingAction ? QUICK_ADD_ACTION_LABELS[pendingAction] : "Quick Add"}</DialogTitle>
            <DialogDescription>Choose the project you want to work on.</DialogDescription>
          </DialogHeader>
          <ProjectCombobox id="quick-add-project" projects={eligibleProjects} value={selectedProjectId} onValueChange={setSelectedProjectId} ariaLabel="Choose project for Quick Add" placeholder="Select a project" />
          {eligibleProjects.length === 0 && <p className="text-sm text-muted-foreground">No projects are available for this action.</p>}
          <DialogFooter className="flex-wrap">
            <Button type="button" variant="outline" onClick={closePicker}>Cancel</Button>
            {pendingAction === "message" && <Button type="button" variant="outline" disabled={!selectedDestination} onClick={() => continueToProject(true)}>Open messages</Button>}
            <Button type="button" disabled={!selectedDestination} onClick={() => continueToProject()}>{pendingAction === "message" ? "Compose message" : "Continue"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
