"use client"

import * as React from "react"
import Link from "next/link"
import { toast } from "sonner"
import {
  getPaperTrailChoices,
  resolvePaperTrailDuplicate,
  type PaperTrailChoiceItem,
  type PaperTrailDuplicateChoice,
} from "@/app/actions/paper-trail"
import { Button } from "@/components/ui/button"

const CHOICE_DONE: { readonly [K in PaperTrailDuplicateChoice]: string } = {
  replace: "Compass will update the existing file",
  keep_both: "Compass will save its copy beside the existing file",
  keep_existing: "Keeping the existing file",
}

/**
 * Records whose file was already saved by hand, across the company. Compass
 * holds them instead of writing a duplicate until someone picks what to do.
 */
export function PaperTrailChoices(): React.ReactElement | null {
  const [items, setItems] = React.useState<readonly PaperTrailChoiceItem[] | null>(null)
  const [pending, startTransition] = React.useTransition()

  const load = React.useCallback(async () => {
    const result = await getPaperTrailChoices()
    setItems(result.success ? result.data : [])
  }, [])

  React.useEffect(() => {
    void load()
  }, [load])

  function choose(item: PaperTrailChoiceItem, choice: PaperTrailDuplicateChoice): void {
    startTransition(async () => {
      const result = await resolvePaperTrailDuplicate(item.projectId, item.recordType, item.recordId, choice)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success(CHOICE_DONE[choice])
      setItems((current) => current?.filter((row) => !(row.recordType === item.recordType && row.recordId === item.recordId)) ?? null)
    })
  }

  if (!items || items.length === 0) return null
  return (
    <div className="space-y-2 border-t pt-4">
      <h3 className="text-sm font-semibold">Already in Drive ({items.length})</h3>
      <p className="text-xs text-muted-foreground">
        A file that looks like each of these records was already saved in its folder, so Compass didn&apos;t save a second copy. Replace
        updates that file with Compass&apos;s version (Drive keeps the old one in its version history); Keep both saves Compass&apos;s copy
        beside it; Keep existing stops Compass saving the record.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-xs">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="py-1.5 pr-2 font-medium">Project</th>
              <th className="py-1.5 pr-2 font-medium">Record</th>
              <th className="py-1.5 pr-2 font-medium">File already in Drive</th>
              <th className="py-1.5" />
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={`${item.recordType}:${item.recordId}`} className="border-b align-top">
                <td className="py-1.5 pr-2">
                  <Link href={`/dashboard/projects/${item.projectId}`} className="underline-offset-2 hover:underline">
                    {item.projectLabel}
                  </Link>
                </td>
                <td className="py-1.5 pr-2">{item.recordTypeLabel}</td>
                <td className="py-1.5 pr-2">
                  {item.existingFile ? (
                    <a href={item.existingFile.url} target="_blank" rel="noreferrer" className="underline underline-offset-2">
                      {item.existingFile.name}
                    </a>
                  ) : (
                    "Unknown"
                  )}
                </td>
                <td className="py-1.5">
                  <div className="flex flex-wrap justify-end gap-1.5">
                    <Button type="button" size="sm" variant="outline" className="h-7 text-xs" disabled={pending} onClick={() => choose(item, "replace")}>
                      Replace
                    </Button>
                    <Button type="button" size="sm" variant="outline" className="h-7 text-xs" disabled={pending} onClick={() => choose(item, "keep_both")}>
                      Keep both
                    </Button>
                    <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" disabled={pending} onClick={() => choose(item, "keep_existing")}>
                      Keep existing
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
