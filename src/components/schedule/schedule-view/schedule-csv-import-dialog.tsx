"use client"

import { useRef, useState } from "react"
import { toast } from "sonner"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { IconUpload, IconLoader2 } from "@tabler/icons-react"
import { parseScheduleCsv } from "./schedule-view-rules"

/** Reads a CSV of schedule items and downloads them as JSON for review. */
export function ScheduleCsvImportDialog({
  open: importDialogOpen,
  onOpenChange: setImportDialogOpen,
}: {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
}) {
  const [isImporting, setIsImporting] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // CSV import
  const handleFileSelect = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0]
    if (!file) return

    setIsImporting(true)
    try {
      const text = await file.text()
      const parsed = parseScheduleCsv(text)

      if (parsed.length > 0) {
        const blob = new Blob(
          [JSON.stringify(parsed, null, 2)],
          { type: "application/json" }
        )
        const url = URL.createObjectURL(blob)
        const link = document.createElement("a")
        link.href = url
        link.download = `imported-tasks-${Date.now()}.json`
        link.click()
        URL.revokeObjectURL(url)
        toast.success(
          `Parsed ${parsed.length} schedule items from CSV for review.`
        )
      } else {
        toast.error("No valid schedule items found in the CSV file.")
      }
    } catch (error) {
      console.error("Import failed:", error)
      toast.error("Failed to parse CSV file. Please check the format.")
    } finally {
      setIsImporting(false)
      setImportDialogOpen(false)
      if (fileInputRef.current) {
        fileInputRef.current.value = ""
      }
    }
  }

  return (
    <Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Import Schedule</DialogTitle>
          <DialogDescription>
            Upload a CSV file with columns for title, start date, duration,
            phase, and assigned to.
          </DialogDescription>
        </DialogHeader>
        <div className="border-2 border-dashed rounded-lg p-8 text-center">
          <Input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            className="hidden"
            onChange={handleFileSelect}
          />
          <Button
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
            disabled={isImporting}
          >
            {isImporting ? (
              <>
                <IconLoader2 className="size-4 mr-2 animate-spin" />
                Importing...
              </>
            ) : (
              <>
                <IconUpload className="size-4 mr-2" />
                Select CSV File
              </>
            )}
          </Button>
          <p className="text-xs text-muted-foreground mt-2">
            Supported format: CSV with headers
          </p>
        </div>
      </DialogContent>
    </Dialog>
  )
}
