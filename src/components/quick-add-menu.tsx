"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import {
  IconCalendarStats,
  IconClipboardText,
  IconListCheck,
  IconPlus,
} from "@tabler/icons-react"

import { useActiveProject, useProjectList } from "@/components/project-list-provider"
import { ProjectCombobox } from "@/components/projects/project-combobox"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  QUICK_ADD_ACTION_LABELS,
  quickAddHref,
  type QuickAddAction,
} from "@/lib/quick-add"

type QuickAddMenuProps = {
  readonly actions: readonly QuickAddAction[]
}

function ActionIcon({ action }: { readonly action: QuickAddAction }): React.ReactElement {
  switch (action) {
    case "daily-log":
      return <IconClipboardText className="size-4" />
    case "schedule-item":
      return <IconCalendarStats className="size-4" />
    case "todo":
      return <IconListCheck className="size-4" />
  }
}

export function QuickAddMenu({ actions }: QuickAddMenuProps): React.ReactElement | null {
  const router = useRouter()
  const projects = useProjectList()
  const { activeProject, setActiveProjectId } = useActiveProject()
  const [pendingAction, setPendingAction] = React.useState<QuickAddAction | null>(null)
  const [selectedProjectId, setSelectedProjectId] = React.useState("")

  if (actions.length === 0) return null

  function navigateToAction(action: QuickAddAction, projectId: string): void {
    setActiveProjectId(projectId)
    setPendingAction(null)
    setSelectedProjectId("")
    router.push(quickAddHref(action, projectId))
  }

  function handleAction(action: QuickAddAction): void {
    if (activeProject) {
      navigateToAction(action, activeProject.id)
      return
    }
    setSelectedProjectId("")
    setPendingAction(action)
  }

  function handleProjectContinue(): void {
    if (!pendingAction) return
    const project = projects.find((candidate) => candidate.id === selectedProjectId)
    if (!project) return
    navigateToAction(pendingAction, project.id)
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 px-2 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            aria-label="Quick Add"
            data-quick-add-trigger
          >
            <IconPlus className="size-4" />
            <span className="hidden lg:inline">Quick Add</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuLabel>Start project work</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {actions.map((action) => (
            <DropdownMenuItem
              key={action}
              onSelect={() => handleAction(action)}
              data-quick-add-action={action}
            >
              <ActionIcon action={action} />
              {QUICK_ADD_ACTION_LABELS[action]}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog
        open={pendingAction !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPendingAction(null)
            setSelectedProjectId("")
          }
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              Choose a project for {pendingAction ? QUICK_ADD_ACTION_LABELS[pendingAction] : "new work"}
            </DialogTitle>
            <DialogDescription>
              Quick Add uses the existing project workflow and keeps its normal permissions and validation.
            </DialogDescription>
          </DialogHeader>
          <ProjectCombobox
            id="quick-add-project"
            projects={projects}
            value={selectedProjectId}
            onValueChange={setSelectedProjectId}
            ariaLabel="Choose project for Quick Add"
            placeholder="Select a project"
            searchPlaceholder="Search projects..."
          />
          {projects.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No projects are available in the active organization.
            </p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setPendingAction(null)
                setSelectedProjectId("")
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleProjectContinue}
              disabled={selectedProjectId.length === 0}
            >
              Continue
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
