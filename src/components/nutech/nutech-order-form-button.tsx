"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { IconExternalLink, IconFileSpreadsheet } from "@tabler/icons-react"
import { toast } from "sonner"
import { generateNuTechAirliteWorkbook } from "@/app/actions/nutech-order-items"
import { Button } from "@/components/ui/button"

/**
 * Beside the pickup copy on the manufacturer's PO: the manufacturer's own
 * order form, filled from the Nu-Tech order. Opens the
 * latest copy, or generates one (again, while the PO is unreleased).
 */
export function NuTechOrderFormButton({
  projectId,
  workbookUrl,
  released,
}: {
  readonly projectId: string
  readonly workbookUrl: string | null
  readonly released: boolean
}): React.ReactElement {
  const router = useRouter()
  const [pending, startTransition] = React.useTransition()

  function generate(): void {
    startTransition(async () => {
      const result = await generateNuTechAirliteWorkbook(projectId)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success("Order form filled in the project's Drive folder.")
      if (result.workbookUrl) window.open(result.workbookUrl, "_blank", "noopener")
      router.refresh()
    })
  }

  return (
    <>
      {workbookUrl && (
        <Button asChild type="button" variant="outline" size="sm" className="print:hidden">
          <a href={workbookUrl} target="_blank" rel="noreferrer">
            <IconExternalLink className="size-4" />
            Order form
          </a>
        </Button>
      )}
      {!released && (
        <Button type="button" variant="outline" size="sm" disabled={pending} onClick={generate} className="print:hidden">
          <IconFileSpreadsheet className="size-4" />
          {pending ? "Filling…" : workbookUrl ? "Refill order form" : "Fill order form"}
        </Button>
      )}
    </>
  )
}
