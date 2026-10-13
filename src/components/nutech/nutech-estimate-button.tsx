"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { IconCalculator } from "@tabler/icons-react"
import { toast } from "sonner"
import { createNuTechEstimateFromOrder } from "@/app/actions/nutech-estimate"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"

/**
 * Fills the order's Compass estimate from the Nu-Tech order (products,
 * shipping and the sales tax district). Asks before replacing a draft's
 * existing lines. Save the order first so the latest shipping and tax are used.
 */
export function NuTechEstimateButton({
  projectId,
  orderId,
  disabled,
}: {
  readonly projectId: string
  /** The order that fills its estimate; null uses the job's newest order. */
  readonly orderId: string | null
  readonly disabled: boolean
}): React.ReactElement {
  const router = useRouter()
  const [pending, startTransition] = React.useTransition()
  const [confirm, setConfirm] = React.useState<{ readonly estimateNumber: string; readonly lineCount: number } | null>(null)

  function run(replace: boolean): void {
    startTransition(async () => {
      const result = await createNuTechEstimateFromOrder(projectId, replace, orderId)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      if (result.data.kind === "confirm_replace") {
        setConfirm({ estimateNumber: result.data.estimateNumber, lineCount: result.data.lineCount })
        return
      }
      setConfirm(null)
      toast.success(
        `${result.data.created ? "Estimate created" : "Estimate updated"} with ${result.data.lineCount} line${result.data.lineCount === 1 ? "" : "s"} from the order.`,
        { action: { label: "Open estimate", onClick: () => router.push(`/dashboard/projects/${encodeURIComponent(projectId)}/estimate`) } },
      )
      router.refresh()
    })
  }

  return (
    <>
      <Button type="button" size="sm" variant="outline" disabled={disabled || pending} onClick={() => run(false)}>
        <IconCalculator className="size-4" />
        {pending ? "Filling the estimate…" : "Create estimate from order"}
      </Button>
      <AlertDialog open={confirm !== null} onOpenChange={(open) => (open ? null : setConfirm(null))}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Replace the estimate&apos;s lines?</AlertDialogTitle>
            <AlertDialogDescription>
              Draft estimate {confirm?.estimateNumber} already has {confirm?.lineCount} line{confirm?.lineCount === 1 ? "" : "s"}. They will be
              replaced with this order&apos;s products, shipping and sales tax. The estimate&apos;s text, terms and acknowledgements stay as they are.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Keep the estimate</AlertDialogCancel>
            <AlertDialogAction disabled={pending} onClick={(event) => { event.preventDefault(); run(true) }}>
              Replace lines
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
