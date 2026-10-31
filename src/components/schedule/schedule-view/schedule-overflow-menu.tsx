"use client"

import Link from "next/link"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  IconDots,
  IconDownload,
  IconUpload,
  IconPrinter,
  IconHistory,
  IconCalendarOff,
  IconTemplate,
} from "@tabler/icons-react"

/** Templates, CSV, print, baselines and workday exceptions. */
export function ScheduleOverflowMenu({
  projectId,
  setBulkTemplateDialogOpen,
  setTemplateDialogOpen,
  setSaveTemplateDialogOpen,
  handleExportCSV,
  setImportDialogOpen,
  setPrintDialogOpen,
  setBaselinesOpen,
  setExceptionsOpen,
}: {
  readonly projectId: string | null
  readonly setBulkTemplateDialogOpen: (open: boolean) => void
  readonly setTemplateDialogOpen: (open: boolean) => void
  readonly setSaveTemplateDialogOpen: (open: boolean) => void
  readonly handleExportCSV: () => void
  readonly setImportDialogOpen: (open: boolean) => void
  readonly setPrintDialogOpen: (open: boolean) => void
  readonly setBaselinesOpen: (open: boolean) => void
  readonly setExceptionsOpen: (open: boolean) => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          aria-label="More schedule actions"
        >
          <IconDots className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        {projectId && (
          <>
            <DropdownMenuItem onClick={() => setBulkTemplateDialogOpen(true)}>
              <IconTemplate className="size-4 mr-2" />
              Import schedule items
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setTemplateDialogOpen(true)}>
              <IconTemplate className="size-4 mr-2" />
              Add full project setup
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setSaveTemplateDialogOpen(true)}>
              <IconTemplate className="size-4 mr-2" />
              Save schedule as template
            </DropdownMenuItem>
          </>
        )}
        <DropdownMenuItem asChild>
          <Link href="/dashboard/templates">
            <IconTemplate className="size-4 mr-2" />
            Template Library
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handleExportCSV}>
          <IconDownload className="size-4 mr-2" />
          Export CSV
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setImportDialogOpen(true)}>
          <IconUpload className="size-4 mr-2" />
          Import CSV
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setPrintDialogOpen(true)}>
          <IconPrinter className="size-4 mr-2" />
          Print Preview…
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => setBaselinesOpen(true)}>
          <IconHistory className="size-4 mr-2" />
          Baselines
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setExceptionsOpen(true)}>
          <IconCalendarOff className="size-4 mr-2" />
          Workday Exceptions
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
