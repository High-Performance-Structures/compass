"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { IconFileImport } from "@tabler/icons-react"
import { toast } from "sonner"

import { importBuildertrendEstimateExport } from "@/app/actions/project-estimates"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import {
  parseBuildertrendEstimateRows,
  type BuildertrendEstimateParseResult,
} from "@/lib/estimates/buildertrend-estimate-import"

const MAX_FILE_BYTES = 10 * 1024 * 1024

function money(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" })
}

type Parsed = Extract<BuildertrendEstimateParseResult, { readonly success: true }>

/**
 * Imports a Buildertrend "Estimate report" export (.xls/.xlsx) into this
 * estimate. The file is read in the browser; the server re-validates the rows
 * and cost codes before saving.
 */
export function ProjectEstimateBuildertrendImport({
  projectId,
  estimateId,
  existingLineCount,
}: {
  readonly projectId: string
  readonly estimateId: string
  readonly existingLineCount: number
}): React.ReactElement {
  const router = useRouter()
  const inputRef = React.useRef<HTMLInputElement>(null)
  const [open, setOpen] = React.useState(false)
  const [fileName, setFileName] = React.useState("")
  const [parsed, setParsed] = React.useState<Parsed | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [replace, setReplace] = React.useState(false)
  const [reading, setReading] = React.useState(false)
  const [pending, startTransition] = React.useTransition()

  async function readFile(file: File): Promise<void> {
    setError(null)
    setParsed(null)
    setFileName(file.name)
    if (file.size > MAX_FILE_BYTES) {
      setError("Choose a file smaller than 10 MB.")
      return
    }
    setReading(true)
    try {
      const XLSX = await import("xlsx")
      const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: false })
      const sheet = workbook.Sheets[workbook.SheetNames[0] ?? ""]
      if (!sheet) {
        setError("The file has no worksheet.")
        return
      }
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" })
      const result = parseBuildertrendEstimateRows(rows)
      if (!result.success) setError(result.error)
      else setParsed(result)
    } catch {
      setError("Unable to read that file. Export the estimate from Buildertrend as a spreadsheet and try again.")
    } finally {
      setReading(false)
    }
  }

  function runImport(): void {
    if (!parsed) return
    startTransition(async () => {
      const result = await importBuildertrendEstimateExport(projectId, estimateId, {
        sourceFileName: fileName,
        replaceExisting: replace,
        lines: parsed.lines,
        phases: parsed.phases,
      })
      if (!result.success) {
        setError(result.error)
        return
      }
      toast.success(`Imported ${result.lineCount} lines (${money(result.totalCents)}).`)
      setOpen(false)
      setParsed(null)
      router.refresh()
    })
  }

  const needsReplace = existingLineCount > 0
  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        <IconFileImport className="size-4" />
        Import Buildertrend estimate
      </Button>
      <Dialog open={open} onOpenChange={(next) => { if (!pending) setOpen(next) }}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Import a Buildertrend estimate</DialogTitle>
            <DialogDescription>
              In Buildertrend, open the estimate and export the estimate report as a spreadsheet. Each row becomes an estimate
              line, and each scope package (parent group) becomes a report phase shown as a package total with its description.
              Amounts are kept exactly as exported.
            </DialogDescription>
          </DialogHeader>
          <input
            ref={inputRef}
            type="file"
            accept=".xls,.xlsx,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) void readFile(file)
              event.target.value = ""
            }}
          />
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" variant="outline" disabled={reading || pending} onClick={() => inputRef.current?.click()}>
              {reading ? "Reading…" : fileName ? "Choose a different file" : "Choose export file"}
            </Button>
            {fileName ? <span className="text-sm text-muted-foreground">{fileName}</span> : null}
          </div>
          {error ? <p role="alert" className="border-l-2 border-destructive pl-3 text-sm text-destructive">{error}</p> : null}
          {parsed ? (
            <div className="space-y-3">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="py-1.5 font-medium">Scope package (report phase)</th>
                    <th className="py-1.5 text-right font-medium">Lines</th>
                    <th className="py-1.5 text-right font-medium">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {parsed.phases.map((phase) => {
                    const lines = parsed.lines.filter((line) => line.phaseName === phase.name)
                    return (
                      <tr key={phase.name} className="border-b">
                        <td className="py-1.5">{phase.name}</td>
                        <td className="py-1.5 text-right tabular-nums">{lines.length}</td>
                        <td className="py-1.5 text-right tabular-nums">{money(lines.reduce((sum, line) => sum + line.lineTotalCents, 0))}</td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr className="font-medium">
                    <td className="py-1.5">{parsed.lines.length} lines · builder cost {money(parsed.directCostCents)}</td>
                    <td />
                    <td className="py-1.5 text-right tabular-nums">{money(parsed.totalCents)}</td>
                  </tr>
                </tfoot>
              </table>
              <p className="text-xs text-muted-foreground">
                Check the total against the signed proposal. You can reorder the packages and edit their descriptions in Report
                phases after importing.
              </p>
              {needsReplace ? (
                <div className="flex items-start gap-2">
                  <Checkbox id="bt-import-replace" checked={replace} onCheckedChange={(value) => setReplace(value === true)} disabled={pending} />
                  <Label htmlFor="bt-import-replace" className="text-sm font-normal leading-5">
                    Replace this estimate&apos;s {existingLineCount} existing {existingLineCount === 1 ? "line" : "lines"} and report phases
                  </Label>
                </div>
              ) : null}
            </div>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="ghost" disabled={pending} onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="button" disabled={!parsed || pending || (needsReplace && !replace)} onClick={runImport}>
              {pending ? "Importing…" : parsed ? `Import ${parsed.lines.length} lines` : "Import"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
